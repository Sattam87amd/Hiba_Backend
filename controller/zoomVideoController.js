// zoomVideoController.js - FIXED VERSION
import asyncHandler from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { UserToExpertSession } from '../model/usertoexpertsession.model.js';
import { ExpertToExpertSession } from '../model/experttoexpertsession.model.js';
import { Expert } from '../model/expert.model.js';
import Transaction from '../model/transaction.model.js';
// Use environment variables
const ZOOM_SDK_KEY = process.env.ZOOM_SDK_KEY || 'YIpt60fa5SeNP604nMooFeQxAJZSdr6bz0bR';
const ZOOM_SDK_SECRET = process.env.ZOOM_SDK_SECRET || 'Fxdu9TYkCPBGMeh8Mqbp4FSrrlsBxsBzWVEP';

// Generate Zoom Video SDK JWT Token
const generateZoomVideoSDKToken = (sessionName, roleType, userIdentity) => {
  const iat = Math.floor(Date.now() / 1000) - 30; // 30 seconds buffer
  const exp = iat + 60 * 60 * 2; // 2 hours expiry

  // CRITICAL: Payload structure must match Zoom's requirements exactly
  const payload = {
    app_key: ZOOM_SDK_KEY,
    tpc: sessionName,           // topic - MUST be identical for all participants
    role_type: roleType,        // MUST be number: 1 for host, 0 for participant
    user_identity: userIdentity,
    version: 1,
    iat: iat,
    exp: exp
  };

  // Generate token with proper header
  const token = jwt.sign(payload, ZOOM_SDK_SECRET, { 
    algorithm: 'HS256',
    header: { alg: 'HS256', typ: 'JWT' }
  });
  
  return token;
};

// Generate consistent session name without special characters
const generateSessionName = (meetingId, sessionId) => {
  // Remove any special characters and use only alphanumeric
  const cleanMeetingId = meetingId.toString().replace(/[^a-zA-Z0-9]/g, '');
  const cleanSessionId = sessionId.toString().replace(/[^a-zA-Z0-9]/g, '');
  return `session${cleanSessionId}${cleanMeetingId}`;
};

// Session state management
const activeSessions = new Map();

// Generate Expert Video SDK token
const generateExpertVideoSDKToken = asyncHandler(async (req, res) => {
  const { meetingId, sessionId } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    console.log('=== GENERATE EXPERT VIDEO SDK TOKEN ===');
    console.log('Meeting ID:', meetingId);
    console.log('Session ID:', sessionId);
    
    if (!meetingId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Meeting ID and Session ID are required'
      });
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    const userRole = decoded.role;
    
    if (userRole !== 'expert') {
      return res.status(403).json({
        success: false,
        message: 'Only experts can host meetings'
      });
    }
    
    // Fetch expert's real name from expert collection
    let firstName = 'Unknown';
    let lastName = 'Expert';
    const expertDoc = await Expert.findById(userId);
    if (expertDoc) {
      firstName = expertDoc.firstName || firstName;
      lastName = expertDoc.lastName || lastName;
    }
    
    // Generate consistent session name
    const sessionName = generateSessionName(meetingId, sessionId);
    const userIdentity = `expert_${userId}`;
    
    console.log('🚀 Generating expert token:', {
      sessionName,
      userIdentity,
      roleType: 1,
      sdkKey: ZOOM_SDK_KEY.substring(0, 10) + '...',
      firstName,
      lastName
    });
    
    // Generate JWT token with host role (1)
    const videoSDKToken = generateZoomVideoSDKToken(
      sessionName,
      1, // Host role - MUST be number
      userIdentity
    );
    
    // Store session info
    activeSessions.set(sessionId, {
      meetingId,
      expertId: userId,
      sessionName,
      createdTime: new Date(),
      status: 'created',
      participants: [],
      expertJoined: false,
      userJoined: false
    });
    
    console.log('✅ Generated expert token successfully');
    
    // Create authData object with all required fields
    const authData = {
      token: videoSDKToken,
      sessionName: sessionName,
      sessionPassword: '', // No password for Video SDK
      userIdentity: userIdentity,
      role: 1, // Host role - MUST be number
      sdkKey: ZOOM_SDK_KEY,
      meetingId: meetingId,
      sessionId: sessionId,
      firstName: firstName,
      lastName: lastName
    };
    
    console.log('Auth data generated:', {
      role: authData.role,
      sessionName: authData.sessionName,
      userIdentity: authData.userIdentity
    });
    
    res.status(200).json({
      success: true,
      data: authData
    });
    
  } catch (error) {
    console.error('❌ Error generating expert video SDK token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate video SDK token',
      error: error.message
    });
  }
});

// Generate User Video SDK token
const generateUserVideoSDKToken = asyncHandler(async (req, res) => {
  const { meetingId, sessionId } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    if (!meetingId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Meeting ID and Session ID are required'
      });
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    // Fetch user's real name from usertoexpertsession collection
    let firstName = 'Unknown';
    let lastName = 'User';
    const sessionDoc = await UserToExpertSession.findOne({ _id: sessionId, userId });
    if (sessionDoc) {
      firstName = sessionDoc.firstName || firstName;
      lastName = sessionDoc.lastName || lastName;
    }
    
    // Use the SAME session name as expert
    const sessionName = generateSessionName(meetingId, sessionId);
    const userIdentity = `user_${userId}`;
    
    console.log('🚀 Generating user token:', {
      sessionName,
      userIdentity,
      roleType: 0,
      sdkKey: ZOOM_SDK_KEY.substring(0, 10) + '...',
      firstName,
      lastName
    });
    
    // Generate JWT token with participant role (0)
    const videoSDKToken = generateZoomVideoSDKToken(
      sessionName,
      0, // Participant role - MUST be number
      userIdentity
    );
    
    // Update session info if exists
    const session = activeSessions.get(sessionId);
    if (session) {
      session.participants.push({
        userId,
        userIdentity,
        joinTime: new Date()
      });
    }
    
    console.log('✅ Generated user token successfully');
    
    res.status(200).json({
      success: true,
      data: {
        token: videoSDKToken,
        sessionName: sessionName,
        sessionPassword: '', // No password for Video SDK
        userIdentity: userIdentity,
        role: 0, // Participant
        sdkKey: ZOOM_SDK_KEY,
        meetingId: meetingId,
        sessionId: sessionId,
        firstName: firstName,
        lastName: lastName
      }
    });
    
  } catch (error) {
    console.error('❌ Error generating user video SDK token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate video SDK token',
      error: error.message
    });
  }
});

// Track when expert joins the session
const expertJoinedSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    const session = activeSessions.get(sessionId);
    if (session && session.expertId === userId) {
      session.expertJoined = true;
      session.status = 'expert_joined';
      session.expertJoinTime = new Date();
      
      console.log(`✅ Expert joined session: ${sessionId}`);
      
      res.status(200).json({
        success: true,
        message: 'Expert join status updated'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Session not found or unauthorized'
      });
    }
  } catch (error) {
    console.error('Error updating expert join status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update expert join status'
    });
  }
});

// Track when user joins the session
// Track when user joins the session - UPDATED VERSION
const userJoinedSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    // Get or create session
    let session = activeSessions.get(sessionId);
    if (!session) {
      // Create session if it doesn't exist (user joined before expert)
      session = {
        meetingId: '7308050093', // Default meeting ID
        sessionId: sessionId,
        sessionName: generateSessionName('7308050093', sessionId),
        createdTime: new Date(),
        status: 'user_joined_first',
        participants: [],
        expertJoined: false,
        userJoined: false
      };
      activeSessions.set(sessionId, session);
      console.log(`📝 Created new session for user: ${sessionId}`);
    }
    
    // Update session with user join info
    session.userJoined = true;
    session.userJoinTime = new Date();
    
    if (session.expertJoined) {
      session.status = 'both_joined';
    } else {
      session.status = session.status === 'user_joined_first' ? 'user_joined_first' : 'user_joined';
    }
    
    console.log(`✅ User joined session: ${sessionId}, status: ${session.status}`);
    
    res.status(200).json({
      success: true,
      message: 'User join status updated',
      sessionStatus: session.status
    });
    
  } catch (error) {
    console.error('Error updating user join status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user join status',
      error: error.message
    });
  }
});

// Start a session
const startSession = asyncHandler(async (req, res) => {
  const { sessionId, meetingId } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    const session = activeSessions.get(sessionId);
    if (session) {
      session.status = 'active';
      session.startTime = new Date();
    }
    
    console.log(`✅ Session started: ${sessionId}`);
    
    res.status(200).json({
      success: true,
      message: 'Session started successfully',
      sessionId: sessionId,
      meetingId: meetingId
    });
    
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start session',
      error: error.message
    });
  }
});

// End a session
const endSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    session.status = 'ended';
    session.endTime = new Date();
    
    // Clean up after a delay
    setTimeout(() => {
      activeSessions.delete(sessionId);
    }, 300000); // 5 minutes
    
    console.log(`✅ Session ended: ${sessionId}`);
    
    res.status(200).json({
      success: true,
      message: 'Session ended successfully',
      sessionId: sessionId
    });
    
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end session',
      error: error.message
    });
  }
});

// Get session status
const getSessionStatus = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    res.status(200).json({
      success: true,
      session: {
        sessionId: sessionId,
        meetingId: session.meetingId,
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        expertJoined: session.expertJoined,
        userJoined: session.userJoined,
        participantCount: session.participants.length
      }
    });
    
  } catch (error) {
    console.error('Error getting session status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get session status',
      error: error.message
    });
  }
});

// Get session details for expert
const getSessionDetails = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authorization token required"
      });
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    // Try to find session in both collections
    let sessionDoc = await UserToExpertSession.findById(sessionId)
      .populate('expertId', 'firstName lastName email')
      .populate('userId', 'firstName lastName email');
      
    if (!sessionDoc) {
      sessionDoc = await ExpertToExpertSession.findById(sessionId)
        .populate('expertId', 'firstName lastName email')
        .populate('consultingExpertID', 'firstName lastName email');
    }

    if (!sessionDoc) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Generate session name
    const sessionName = generateSessionName(sessionDoc.zoomMeetingId || '7308050093', sessionId);
    
    // Prepare session data
    const sessionData = {
      _id: sessionId,
      duration: sessionDoc.duration || '15 minutes',
      status: sessionDoc.status || 'confirmed',
      slots: sessionDoc.slots || [],
      zoomMeetingId: sessionDoc.zoomMeetingId || '7308050093',
      zoomSessionName: sessionName,
      zoomPassword: sessionDoc.zoomPassword || '',
      sessionType: sessionDoc.sessionType || 'user-to-expert',
      createdAt: sessionDoc.createdAt,
      updatedAt: sessionDoc.updatedAt,
      // Add the required ID fields
      expertId: sessionDoc.expertId?._id?.toString() || (typeof sessionDoc.expertId === 'string' ? sessionDoc.expertId : ''),
      consultingExpertID: sessionDoc.consultingExpertID?._id?.toString() || (typeof sessionDoc.consultingExpertID === 'string' ? sessionDoc.consultingExpertID : ''),
      // Keep the existing name and email fields
      expertFirstName: sessionDoc.expertId?.firstName || '',
      expertLastName: sessionDoc.expertId?.lastName || '',
      expertEmail: sessionDoc.expertId?.email || '',
      // Add user details if it's a user-to-expert session
      ...(sessionDoc.userId && {
        userFirstName: sessionDoc.userId.firstName || '',
        userLastName: sessionDoc.userId.lastName || '',
        userEmail: sessionDoc.userId.email || ''
      }),
      // Add second expert details if it's an expert-to-expert session
      ...(sessionDoc.consultingExpertID && {
        secondExpertFirstName: sessionDoc.consultingExpertID.firstName || '',
        secondExpertLastName: sessionDoc.consultingExpertID.lastName || '',
        secondExpertEmail: sessionDoc.consultingExpertID.email || ''
      })
    };
    
    console.log(`✅ Session details retrieved: ${sessionId}`);
    
    res.status(200).json({
      success: true,
      session: sessionData
    });
    
  } catch (error) {
    console.error('Error getting session details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get session details',
      error: error.message
    });
  }
});

// Get session details for user
const getUserSessionDetails = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  try {
    // Populate expert's info from expert collection
    const sessionDoc = await UserToExpertSession.findById(sessionId)
      .populate('expertId', 'firstName lastName email')
      .lean();
    if (!sessionDoc) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    const expert = sessionDoc.expertId || {};
    const sessionName = generateSessionName(sessionDoc.zoomMeetingId || '7308050093', sessionId);
    const sessionData = {
      _id: sessionId,
      duration: sessionDoc.duration || '15 minutes',
      status: sessionDoc.status || 'confirmed',
      slots: sessionDoc.slots || [{ selectedDate: new Date().toISOString().split('T')[0], selectedTime: '10:00 AM' }],
      zoomMeetingId: sessionDoc.zoomMeetingId || '7308050093',
      zoomSessionName: sessionName,
      zoomPassword: sessionDoc.zoomPassword || '',
      sessionType: sessionDoc.sessionType || 'user-to-expert',
      createdAt: sessionDoc.createdAt,
      updatedAt: sessionDoc.updatedAt,
      expertFirstName: expert.firstName || '',
      expertLastName: expert.lastName || '',
      expertEmail: expert.email || ''
    };
    res.status(200).json({
      success: true,
      session: sessionData
    });
  } catch (error) {
    console.error('❌ Error getting user session details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get session details',
      error: error.message
    });
  }
});

const completeUserSession = asyncHandler(async (req, res) => {
  const { sessionId, endTime, status, actualDuration } = req.body;
  
  try {
    let sessionDoc = await UserToExpertSession.findById(sessionId);
    if (!sessionDoc) {
      sessionDoc = await ExpertToExpertSession.findById(sessionId);
    }
    
    if (!sessionDoc) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Update session status and end time
    sessionDoc.status = 'completed';
    sessionDoc.endTime = endTime || new Date();
    sessionDoc.actualDuration = actualDuration;
    await sessionDoc.save();

    // Check if the session is eligible for payout
    if (sessionDoc.status === 'completed' && !sessionDoc.payoutProcessed && sessionDoc.price > 0) {
      const expertDoc = await Expert.findById(sessionDoc.expertId._id);
      if (expertDoc) {
        const averageRating = expertDoc.averageRating || 0;
        const expertSharePercentage = averageRating >= 4 ? 0.95 : 0.95; // This logic seems redundant, you may want to vary the percentage here.
        const expertShare = sessionDoc.price * expertSharePercentage;
        const platformFee = sessionDoc.price - expertShare;

        // Update session payout details
        sessionDoc.expertPayoutAmount = expertShare;
        sessionDoc.platformFeeAmount = platformFee;

        // Create transaction for expert payout
        const creditTx = await Transaction.create({
          expertId: expertDoc._id,
          type: 'DEPOSIT',
          amount: expertShare,
          status: 'COMPLETED',
          paymentMethod: 'WALLET',
          description: 'Expert session earnings (confirmed)',
          metadata: { origin: 'user_to_expert_session', sessionId: sessionDoc._id }
        });

        expertDoc.wallets = expertDoc.wallets || { earning: { balance: 0, ledger: [] }, spending: { balance: 0, ledger: [] } };
        expertDoc.wallets.earning.balance += expertShare;

        expertDoc.wallets.earning.ledger.push(creditTx._id);
        expertDoc.transactions = expertDoc.transactions || [];
        expertDoc.transactions.push(creditTx._id);

        // Mark payout as processed after successful transaction
        sessionDoc.payoutProcessed = true;
        await expertDoc.save();
      }
    }

    await sessionDoc.save(); // Save session with payout details

    res.status(200).json({
      success: true,
      message: 'Session completed successfully',
      session: sessionDoc,
    });
    
  } catch (error) {
    console.error('❌ Error completing user session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete session',
      error: error.message
    });
  }
});


// Test Zoom credentials
const testZoomCredentials = asyncHandler(async (req, res) => {
  try {
    const testSessionName = 'testsession12345';
    const testUserIdentity = 'test_user';
    const testToken = generateZoomVideoSDKToken(testSessionName, 1, testUserIdentity);
    
    // Decode token to verify
    const decoded = jwt.verify(testToken, ZOOM_SDK_SECRET);
    
    res.status(200).json({
      success: true,
      message: 'Zoom SDK credentials are working',
      sdkKey: ZOOM_SDK_KEY.substring(0, 10) + '...',
      tokenGenerated: true,
      tokenLength: testToken.length,
      decodedPayload: {
        app_key: decoded.app_key.substring(0, 10) + '...',
        tpc: decoded.tpc,
        role_type: decoded.role_type,
        user_identity: decoded.user_identity
      }
    });
    
  } catch (error) {
    console.error('Error testing Zoom credentials:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test Zoom credentials',
      error: error.message
    });
  }
});

// Cleanup old sessions
const cleanupOldSessions = () => {
  const now = new Date();
  const sessionsToDelete = [];
  
  for (const [sessionId, session] of activeSessions.entries()) {
    const sessionTime = session.endTime || session.createdTime;
    const timeDiff = now - new Date(sessionTime);
    
    // Remove sessions older than 2 hours
    if (timeDiff > 7200000) {
      sessionsToDelete.push(sessionId);
    }
  }
  
  sessionsToDelete.forEach(sessionId => {
    activeSessions.delete(sessionId);
    console.log(`🧹 Cleaned up old session: ${sessionId}`);
  });
};

// Run cleanup every 30 minutes
setInterval(cleanupOldSessions, 1800000);

// Update session status
const updateSessionStatus = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { endTime, status, actualDuration } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    // Update in-memory session state
    const session = activeSessions.get(sessionId);
    if (session) {
      session.status = status || 'completed';
      session.endTime = endTime || new Date();
      session.actualDuration = actualDuration;
    }
    
    // Update in database
    let sessionDoc = await UserToExpertSession.findById(sessionId);
    if (!sessionDoc) {
      sessionDoc = await ExpertToExpertSession.findById(sessionId);
    }
    
    if (!sessionDoc) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Update session document
    sessionDoc.status = status || 'completed';
    sessionDoc.endTime = endTime || new Date();
    sessionDoc.actualDuration = actualDuration;
    await sessionDoc.save();
    
    console.log(`✅ Session status updated: ${sessionId}`, {
      status: sessionDoc.status,
      endTime: sessionDoc.endTime,
      actualDuration: sessionDoc.actualDuration
    });
    
    res.status(200).json({
      success: true,
      message: 'Session status updated successfully',
      session: {
        sessionId,
        status: sessionDoc.status,
        endTime: sessionDoc.endTime,
        actualDuration: sessionDoc.actualDuration
      }
    });
    
  } catch (error) {
    console.error('❌ Error updating session status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update session status',
      error: error.message
    });
  }
});

export {
  generateExpertVideoSDKToken,
  generateUserVideoSDKToken,
  expertJoinedSession,
  userJoinedSession,
  startSession,
  endSession,
  getSessionStatus,
  getSessionDetails,
  getUserSessionDetails,
  completeUserSession,
  testZoomCredentials,
  updateSessionStatus
};