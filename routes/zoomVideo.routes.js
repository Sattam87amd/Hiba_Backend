import express from 'express';
import {generateExpertVideoSDKToken, generateUserVideoSDKToken,expertJoinedSession,userJoinedSession
  ,startSession,endSession,getSessionDetails,getUserSessionDetails,getSessionStatus,completeUserSession,testZoomCredentials
} from '../controller/zoomVideoController.js'

const router = express.Router();

// Expert Video SDK token generation
router.post('/generate-expert-video-token', generateExpertVideoSDKToken);

// User Video SDK token generation
router.post('/generate-user-video-token', generateUserVideoSDKToken);

// Session join tracking
router.post('/expert-joined', expertJoinedSession);
router.post('/user-joined', userJoinedSession);

// Session management
router.post('/start-session', startSession);
router.delete('/end-session/:sessionId', endSession);

// Session status and details
router.get('/session-status/:sessionId', getSessionStatus);
router.get('/details/:sessionId', getSessionDetails);
router.get('/get-session/:sessionId', getSessionDetails);
router.get('/user-session-details/:sessionId', getUserSessionDetails);

// User session completion
router.put('/complete-user-session', completeUserSession);

// Test endpoint
router.get('/test-credentials', testZoomCredentials);

export default router;