// server/socketHandler.js - WebSocket handler for real-time participants
import { Server } from 'socket.io';

let io;
const activeMeetings = new Map(); // Store active meetings and their participants

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:3001"], // Add your frontend URLs
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user joining a meeting
    socket.on('join-meeting', (data) => {
      const { meetingId, userInfo, sessionId } = data;
      
      console.log('User joining meeting:', {
        socketId: socket.id,
        meetingId,
        userInfo,
        sessionId
      });

      // Join the meeting room
      socket.join(meetingId);
      
      // Store user info
      socket.userInfo = userInfo;
      socket.meetingId = meetingId;
      socket.sessionId = sessionId;

      // Initialize meeting if it doesn't exist
      if (!activeMeetings.has(meetingId)) {
        activeMeetings.set(meetingId, {
          participants: [],
          sessionId: sessionId
        });
      }

      const meeting = activeMeetings.get(meetingId);
      
      // Add participant to meeting
      const participant = {
        socketId: socket.id,
        userId: userInfo.userId,
        name: userInfo.name,
        role: userInfo.role, // 'expert' or 'user'
        avatar: userInfo.avatar,
        isVideoOn: false,
        isAudioOn: false,
        joinedAt: new Date()
      };

      meeting.participants.push(participant);

      console.log(`Meeting ${meetingId} now has ${meeting.participants.length} participants`);

      // Notify all participants in the meeting about the new participant
      socket.to(meetingId).emit('participant-joined', {
        participant: participant,
        totalParticipants: meeting.participants.length
      });

      // Send current participants list to the newly joined user
      socket.emit('participants-list', {
        participants: meeting.participants.filter(p => p.socketId !== socket.id), // Don't include self
        totalParticipants: meeting.participants.length
      });
    });

    // Handle media state changes (video/audio on/off)
    socket.on('media-state-change', (data) => {
      const { isVideoOn, isAudioOn } = data;
      const meetingId = socket.meetingId;

      if (meetingId && activeMeetings.has(meetingId)) {
        const meeting = activeMeetings.get(meetingId);
        const participant = meeting.participants.find(p => p.socketId === socket.id);
        
        if (participant) {
          participant.isVideoOn = isVideoOn;
          participant.isAudioOn = isAudioOn;

          // Notify other participants about media state change
          socket.to(meetingId).emit('participant-media-change', {
            socketId: socket.id,
            userId: participant.userId,
            isVideoOn,
            isAudioOn
          });
        }
      }
    });

    // Handle session events (warnings, etc.)
    socket.on('session-warning', (data) => {
      const meetingId = socket.meetingId;
      if (meetingId) {
        // Broadcast warning to all participants
        io.to(meetingId).emit('session-warning', data);
      }
    });

    // Handle session end
    socket.on('end-session', (data) => {
      const meetingId = socket.meetingId;
      if (meetingId) {
        // Notify all participants that session ended
        io.to(meetingId).emit('session-ended', {
          reason: 'time_expired',
          ...data
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      const meetingId = socket.meetingId;
      if (meetingId && activeMeetings.has(meetingId)) {
        const meeting = activeMeetings.get(meetingId);
        const participantIndex = meeting.participants.findIndex(p => p.socketId === socket.id);
        
        if (participantIndex !== -1) {
          const participant = meeting.participants[participantIndex];
          meeting.participants.splice(participantIndex, 1);

          console.log(`Participant ${participant.name} left meeting ${meetingId}`);

          // Notify remaining participants
          socket.to(meetingId).emit('participant-left', {
            participant: participant,
            totalParticipants: meeting.participants.length
          });

          // Clean up empty meetings
          if (meeting.participants.length === 0) {
            activeMeetings.delete(meetingId);
            console.log(`Meeting ${meetingId} cleaned up (no participants)`);
          }
        }
      }
    });
  });

  return io;
};

const getActiveMeetings = () => {
  return Array.from(activeMeetings.entries()).map(([meetingId, meeting]) => ({
    meetingId,
    participantCount: meeting.participants.length,
    sessionId: meeting.sessionId
  }));
};

export { initializeSocket, getActiveMeetings };