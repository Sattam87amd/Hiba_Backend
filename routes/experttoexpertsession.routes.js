import { Router } from "express";
import VerifyJwt from "../middleware/auth.middleware.js";
import {
  bookExpertToExpertSession,
  getMySessions,
  getMyBookings,
  declineSession,
  acceptSession,
  getExpertBookedSlots,
  submitRatingAndProcessPayout,
  getExpertPayoutHistory,
  markSessionAsCompleted,
  generateVideoSDKAuth,
  completeSession,
  completeSessionById,
  getSessionDetails
} from "../controller/experttoexpertsession.controller.js";
import { generateVideoSDKSignature } from "../utils/videoSDKHelper.js";
const router = Router();

router.post("/experttoexpertsession", VerifyJwt, bookExpertToExpertSession);
router.get("/getexpertsession", VerifyJwt,getMySessions );
router.get("/mybookings", VerifyJwt, getMyBookings)

//route to handle status of session
router.put("/accept", VerifyJwt, acceptSession);
router.put("/decline", VerifyJwt, declineSession);

// Route to mark a session as completed
router.put("/:sessionId/complete", VerifyJwt, markSessionAsCompleted);

router.get('/booked-slots/:expertId', getExpertBookedSlots);

// Route for submitting a rating and processing payout
router.post("/:sessionId/rating", VerifyJwt, submitRatingAndProcessPayout);

router.post('/generate-video-sdk-auth', generateVideoSDKAuth);

// Complete session (used by frontend)
router.put('/complete-session', completeSession);

// Alternative endpoint format
router.put('/:id/complete', completeSessionById);

// Get session details (used by frontend to get duration)
router.get('/details/:sessionId', getSessionDetails);



export default router;
