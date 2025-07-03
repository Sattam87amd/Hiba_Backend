// routes/wallet.routes.js
import { Router } from 'express';
import VerifyJwt from '../middleware/auth.middleware.js';
import userWalletController from '../controller/userWallet.controller.js';
import { getWalletBalance,createPaymentIntent,getTransactionHistory,processWalletPayment,verifyPayment,webhookHandler } from '../controller/userWallet.controller.js';




const router = Router();

// Expert wallet routes that require authentication
router.get('/balance', VerifyJwt, getWalletBalance);
router.post('/topup', VerifyJwt, createPaymentIntent);
router.get('/transactions', VerifyJwt, getTransactionHistory);
router.post('/pay', VerifyJwt, processWalletPayment);

// Routes that don't require authentication - KEEPING SAME ENDPOINTS
router.get('/callback', verifyPayment); // Same endpoint, but now handles HyperPay
router.post('/webhook', webhookHandler); // Same endpoint, but now handles HyperPay
router.get('/verify', verifyPayment); // Same endpoint, but now handles HyperPay


export default router;