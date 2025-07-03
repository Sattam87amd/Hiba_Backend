import { Router } from "express";
import VerifyJwt from "../middleware/auth.middleware.js";
import {
  getExpertPayoutHistory
} from "../controller/experttoexpertsession.controller.js"; // Assuming controller is there

const router = Router();

// Route for fetching expert payout history
router.get("/expert-payout-history", VerifyJwt, getExpertPayoutHistory);

export default router; 