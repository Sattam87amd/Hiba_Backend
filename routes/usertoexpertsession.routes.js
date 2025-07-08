import { Router } from 'express';
import { 
    bookUserToExpertSession,
    getUserBookedSlots,
    getUserBookings,
    generateUserVideoSDKAuth,
    getUserSessionDetails,
    completeUserSession,
    updateSessionStatus,
    getExpertSessions,        // Add this import
    getCurrentExpertSession,
    markSessionPaid
} from '../controller/usertoexpertsession.controller.js';
import VerifyJwt from '../middleware/auth.middleware.js';
const router = Router();

//router.post('/usertoexpertsession',VerifyJwt, bookSession);

//router.get("/getusersession", VerifyJwt,getMySessions );
//router.get("/mybookings", VerifyJwt, getMyBookings)

//route to handle status of session
// router.put("/accept/:sessionId", VerifyJwt, acceptSession);
// router.put("/decline/:sessionId", VerifyJwt, declineSession);

// Route for booking a session (User to Expert)
router.post("/usertoexpertsession", bookUserToExpertSession);

// Route for getting user bookings (User's past bookings)
router.get("/Userbookings", getUserBookings);


router.get('/user-booked-slots/:expertId', getUserBookedSlots)

// User video call routes
router.post('/generate-user-video-auth', VerifyJwt, generateUserVideoSDKAuth);
router.get('/user-session-details/:sessionId', VerifyJwt, getUserSessionDetails);
router.put('/complete-user-session', VerifyJwt, completeUserSession);

router.get('/expert-sessions/:expertId', VerifyJwt, getExpertSessions);
router.get('/current-expert-session/:expertId', VerifyJwt, getCurrentExpertSession);

// Expert updates status (confirm / reject)
router.patch('/:sessionId/status', VerifyJwt, updateSessionStatus);

router.put('/mark-paid/:sessionId', markSessionPaid)
// // Route for getting expert sessions (Sessions where the expert is providing service)
// router.get("/sessions", getExpertSessions);

// // Route for accepting a session (Confirmed by the expert)
// router.patch("/session/:sessionId/accept", acceptSession);

// // Route for declining a session (Rejected by the expert)
// router.patch("/session/:sessionId/decline", declineSession);

export default router;
