
import asyncHandler from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
// Option 1: Simple HTTP Polling Solution
// Backend: Add these endpoints to your existing controllers

// Meeting participants storage (in-memory, or use Redis/Database)
const activeMeetings = new Map();

// Endpoint to join a meeting
const joinMeeting = asyncHandler(async (req, res) => {
  const { meetingId, sessionId } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    const userRole = decoded.role; // 'user' or 'expert'
    
    console.log(`User ${userId} (${userRole}) joining meeting ${meetingId}`);
    
    // Initialize meeting if it doesn't exist
    if (!activeMeetings.has(meetingId)) {
      activeMeetings.set(meetingId, {
        participants: [],
        sessionId: sessionId,
        lastActivity: new Date()
      });
    }
    
    const meeting = activeMeetings.get(meetingId);
    
    // Check if user already in meeting
    const existingParticipant = meeting.participants.find(p => p.userId === userId);
    
    if (!existingParticipant) {
      // Add new participant
      const participant = {
        userId: userId,
        name: `${decoded.firstName || 'User'} ${decoded.lastName || ''}`.trim(),
        role: userRole, // 'user' or 'expert'
        avatar: userRole === 'expert' ? '👩‍⚕️' : '👤',
        isVideoOn: false,
        isAudioOn: false,
        joinedAt: new Date(),
        lastSeen: new Date()
      };
      
      meeting.participants.push(participant);
      console.log(`✅ Participant added. Meeting ${meetingId} now has ${meeting.participants.length} participants`);
    } else {
      // Update last seen time
      existingParticipant.lastSeen = new Date();
    }
    
    meeting.lastActivity = new Date();
    
    res.status(200).json({
      success: true,
      message: "Joined meeting successfully",
      meetingId: meetingId,
      participantCount: meeting.participants.length,
      participants: meeting.participants.filter(p => p.userId !== userId) // Don't include self
    });
    
  } catch (error) {
    console.error('Error joining meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join meeting',
      error: error.message
    });
  }
});

// Endpoint to get current participants (called periodically by frontend)
const getMeetingParticipants = asyncHandler(async (req, res) => {
  const { meetingId } = req.params;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    if (!activeMeetings.has(meetingId)) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    const meeting = activeMeetings.get(meetingId);
    
    // Update current user's last seen time
    const currentUser = meeting.participants.find(p => p.userId === userId);
    if (currentUser) {
      currentUser.lastSeen = new Date();
    }
    
    // Remove participants who haven't been seen in 30 seconds (disconnected)
    const now = new Date();
    const activeParticipants = meeting.participants.filter(p => {
      const timeDiff = now - new Date(p.lastSeen);
      return timeDiff < 30000; // 30 seconds timeout
    });
    
    // Update participants list
    meeting.participants = activeParticipants;
    meeting.lastActivity = new Date();
    
    res.status(200).json({
      success: true,
      participants: meeting.participants.filter(p => p.userId !== userId), // Exclude self
      totalParticipants: meeting.participants.length,
      meetingId: meetingId
    });
    
  } catch (error) {
    console.error('Error getting participants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get participants',
      error: error.message
    });
  }
});

// Endpoint to update media state
const updateMediaState = asyncHandler(async (req, res) => {
  const { meetingId } = req.params;
  const { isVideoOn, isAudioOn } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    if (!activeMeetings.has(meetingId)) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    const meeting = activeMeetings.get(meetingId);
    const participant = meeting.participants.find(p => p.userId === userId);
    
    if (participant) {
      participant.isVideoOn = isVideoOn;
      participant.isAudioOn = isAudioOn;
      participant.lastSeen = new Date();
      
      console.log(`🎥 Media state updated for ${participant.name}: Video ${isVideoOn ? 'ON' : 'OFF'}, Audio ${isAudioOn ? 'ON' : 'OFF'}`);
    }
    
    meeting.lastActivity = new Date();
    
    res.status(200).json({
      success: true,
      message: 'Media state updated'
    });
    
  } catch (error) {
    console.error('Error updating media state:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update media state',
      error: error.message
    });
  }
});

// Endpoint to leave meeting
const leaveMeeting = asyncHandler(async (req, res) => {
  const { meetingId } = req.params;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    if (!activeMeetings.has(meetingId)) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    const meeting = activeMeetings.get(meetingId);
    const participantIndex = meeting.participants.findIndex(p => p.userId === userId);
    
    if (participantIndex !== -1) {
      const participant = meeting.participants[participantIndex];
      meeting.participants.splice(participantIndex, 1);
      
      console.log(`👋 ${participant.name} left meeting ${meetingId}. ${meeting.participants.length} participants remaining`);
      
      // Clean up empty meetings
      if (meeting.participants.length === 0) {
        activeMeetings.delete(meetingId);
        console.log(`🧹 Meeting ${meetingId} cleaned up (empty)`);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Left meeting successfully'
    });
    
  } catch (error) {
    console.error('Error leaving meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave meeting',
      error: error.message
    });
  }
});

// Cleanup old meetings (run periodically)
const cleanupOldMeetings = () => {
  const now = new Date();
  const meetingsToDelete = [];
  
  for (const [meetingId, meeting] of activeMeetings.entries()) {
    const timeDiff = now - new Date(meeting.lastActivity);
    
    // Remove meetings with no activity for 5 minutes
    if (timeDiff > 300000) { // 5 minutes
      meetingsToDelete.push(meetingId);
    }
  }
  
  meetingsToDelete.forEach(meetingId => {
    activeMeetings.delete(meetingId);
    console.log(`🧹 Cleaned up inactive meeting: ${meetingId}`);
  });
};

// Run cleanup every 2 minutes
setInterval(cleanupOldMeetings, 120000);

export {
  joinMeeting,
  getMeetingParticipants,
  updateMediaState,
  leaveMeeting
};