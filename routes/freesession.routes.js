import { Router } from 'express';
import { 
    updateFreeSessionSettings, 
    checkFreeSessionEligibility 
} from '../controller/freesession.controller.js';
import VerifyJwt from '../middleware/auth.middleware.js';

const router = Router();

// Route to update free session settings for an expert
router.put('/update-free-session', VerifyJwt, updateFreeSessionSettings);

// Route to check if a user is eligible for a free session with an expert
router.get('/check-eligibility/:userId/:expertId', checkFreeSessionEligibility);

export default router;