import express from 'express';

import { Router } from 'express';
import { 
  loginAdmin, 
  updateExpertStatus, 
  getBookingDetails, 
  getreview, 
  forgotPassword,
  getWithdrawalRequests,
  getWithdrawalHistory,
  processWithdrawalRequest,
  getExpertWithdrawalRequests,
  getExpertWithDrawalHistory,
  processExpertWithdrawalRequest,
  getAllTransaction,

} from '../controller/admin.controller.js';


const router = Router();

router.post('/login', loginAdmin);
router.post('/forgot-password', forgotPassword); // New route for forgot password
router.put('/experts/:expertId/status', updateExpertStatus);
router.get("/bookings", getBookingDetails);
router.get("/review", getreview);
router.get('/withdrawal-requests', getWithdrawalRequests)
router.get('/expert-withdrawal-requests', getExpertWithdrawalRequests)
router.post('/withdrawal-requests/:id/process', processWithdrawalRequest)
router.post('/expert-withdrawal-requests/:requestId/process', processExpertWithdrawalRequest)
router.get('/withdrawal-history', getWithdrawalHistory, getExpertWithDrawalHistory); // New route for withdrawal history
router.get('/gettransactions', getAllTransaction)
export default router;