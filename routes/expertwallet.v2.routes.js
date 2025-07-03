import { Router } from 'express';
import VerifyJwt from '../middleware/auth.middleware.js';
import {
  getWalletBalances,
  createSpendingTopup,
  payAnotherExpert,
  creditEarningWallet,
  verifyPayment, // reuse existing
  webhookHandler,
  getTransactionHistory,
  getEarningWalletHistory,
  getSpendingWalletHistory
} from '../controller/expertWallet.controller.js';

const router = Router();

// Balances
router.get('/balances', VerifyJwt, getWalletBalances);

// Spending wallet
router.post('/spending/topup', VerifyJwt, createSpendingTopup);
router.post('/spending/pay', VerifyJwt, payAnotherExpert);
router.get('/spending/history', VerifyJwt, getSpendingWalletHistory);

// Earning wallet
router.post('/earning/credit', VerifyJwt, creditEarningWallet);
router.get('/earning/history', VerifyJwt, getEarningWalletHistory);

// Keep verify & webhook endpoints (not auth protected)
router.get('/callback', verifyPayment);
router.get('/verify', verifyPayment);
router.post('/webhook', webhookHandler);

export default router; 