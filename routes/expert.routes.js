import express from "express";
import multer from 'multer';
import VerifyJwt from "../middleware/auth.middleware.js";
import {
  requestOtp,
  verifyOtp,
  registerExpert,
  getExpertById,
  getExpertsByArea,
  updateExpertCharity,
  updateExpertPrice,
  getExperts,
  updateExpert,
  updateExpertExperience,
  refreshToken,
  updateExpertProfile,
  loginPendingExpert,
  updateExpertProfilePicture,
  getExpertAvailability,
  updateExpertAvailability,
  deactivateExpert,
  checkAccountStatus,
  reactivateAccount,
  getExpertTransactions,
} from "../controller/expert.controller.js";

import {
  updateFreeSessionSettings,
} from "../controller/freesession.controller.js";

const router = express.Router();

// Public Routes
router.post("/request-otp", requestOtp);
router.post("/verify-otp", verifyOtp);
router.post('/pending-login', loginPendingExpert);

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Registration route with file uploads
router.post(
  '/register',
  upload.fields([
    { name: 'photoFile', maxCount: 1 },
    { name: 'certificationFile', maxCount: 1 }
  ]),
  registerExpert
);

// Protected Routes
router.put('/update-free-session', VerifyJwt, updateFreeSessionSettings);
router.get("/:id", getExpertById);
router.get("/", getExperts);
router.get("/area/:area", getExpertsByArea);
router.put("/update-charity", updateExpertCharity);
router.put("/update-price", updateExpertPrice);
router.put('/:id', updateExpert);
router.put('/:id/experience', updateExpertExperience);
router.post('/refresh-token', VerifyJwt, refreshToken);

// Profile update routes
// Single route that handles both regular updates and file uploads
router.put(
  '/updateexpert/:id',
  upload.fields([{ name: 'photoFile', maxCount: 1 }]),
  updateExpertProfile
);

router.get('/availability/:expertId', getExpertAvailability);
router.put('/availability/:expertId', VerifyJwt, updateExpertAvailability);


router.put('/deactivateExpert/:id', deactivateExpert);
// Add these routes to your router
router.post('/check-account-status', checkAccountStatus);
router.post('/reactivate-account', reactivateAccount);

router.get('/getTransactionHistory/:expertId', VerifyJwt,getExpertTransactions )
// Alternative: Separate routes for clarity (you can choose either approach)
/*
// Regular profile update route (no file upload)
router.put('/updateexpert/:id/info', updateExpertProfile);

// Profile picture specific route
router.put(
  '/updateexpert/:id/profilepicture',
  upload.fields([{ name: 'photoFile', maxCount: 1 }]),
  updateExpertProfilePicture
);
*/

export default router;