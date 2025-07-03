import { Router } from 'express';
import {
  purchaseGiftCard,
  handleGiftCardTapWebhook,
  handleGiftCardPaymentSuccess,
  getGiftCardByCode
} from '../controller/giftcard.controller.js';
import VerifyJwt from '../middleware/auth.middleware.js'; // Changed to default import

const router = Router();

// POST /api/giftcard/purchase - Purchase a new gift card
// VerifyJwt is used as optional middleware: if a user is logged in, their ID is attached.
// The controller logic handles cases for both logged-in users and guests.
router.post('/purchase', VerifyJwt, purchaseGiftCard);

// POST /api/giftcard/tap-webhook - Webhook from Tap payment gateway
// This should be an open endpoint for Tap to reach.
router.post('/tap-webhook', handleGiftCardTapWebhook);

// GET /api/giftcard/payment-success - Optional: Redirect for frontend after successful Tap payment
// This could be a GET or POST depending on how Tap redirects and if you need to verify parameters.
// For now, making it a GET as per typical redirect patterns.
router.get('/payment-success', handleGiftCardPaymentSuccess);

// GET /api/giftcard/check/:redemptionCode - Check validity and balance of a gift card
router.get('/check/:redemptionCode', getGiftCardByCode);

export default router; 