// routes/expertWithdrawalRoutes.js
import express from 'express';
import { createexpertWithdrawalRequest, getExpertWithdrawalHistory } from '../controller/expertWithdrawal.controller.js';
import VerifyJwt from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/request', VerifyJwt, createexpertWithdrawalRequest);
router.get('/history', VerifyJwt, getExpertWithdrawalHistory);

export default router;
