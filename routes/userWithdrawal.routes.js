// routes/withdrawalRoutes.js
import express from 'express';
import {
  createWithdrawalRequest,
  getWithdrawalHistory
} from '../controller/userWithdrawal.controller.js';
import VerifyJwt from '../middleware/auth.middleware.js';

const router = express.Router();

// User withdrawal routes
router.post('/request',VerifyJwt , createWithdrawalRequest);
router.get('/history',VerifyJwt, getWithdrawalHistory);

export default router;