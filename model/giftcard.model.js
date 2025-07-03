import mongoose from 'mongoose';

const giftCardSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: [1, 'Gift card amount must be at least 1.'], // Define a minimum amount, e.g., 1 unit of your currency
  },
  purchaserName: {
    type: String,
    trim: true,
  },
  purchaserEmail: {
    type: String,
    trim: true,
    lowercase: true,
  },
  purchaserId: { // ID of the user who purchased the gift card, if they were logged in
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', 
    // Not strictly required, as a guest might purchase a gift card
  },
  recipientName: {
    type: String,
    trim: true,
  },
  recipientEmail: {
    type: String,
    trim: true,
    lowercase: true,
  },
  recipientPhone: { // New field
    type: String,
    trim: true,
    default: null, // Optional
  },
  recipientMessage: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['pending_payment', 'active', 'redeemed', 'expired', 'payment_failed', 'cancelled', 'anonymous_pending_payment', 'anonymous_active'],
    default: 'pending_payment',
  },
  sendAnonymously: { // New field
    type: Boolean,
    default: false,
  },
  redemptionCode: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  paymentId: { // ID from the payment gateway (e.g., Tap charge ID)
    type: String,
  },
  paymentMethod: { // e.g., 'tap', 'wallet'
    type: String, 
  },
  paymentStatus: { // Status from the payment gateway or internal status
    type: String,
  },
  originalAmount: { // Store the original amount in case of partial redemptions if 'amount' field is reduced
    type: Number,
    required: true,
  },
  balance: { // Current available balance on the gift card
    type: Number,
    required: true,
  },
  expiresAt: {
    type: Date,
    // default: () => new Date(Date.now() + 365*24*60*60*1000) // Default to 1 year expiry, adjust as needed
    // For now, let's make it optional or handle expiry logic later if required by user
  },
  // Optional: History of redemptions if partial redemptions are complex
  // redemptionHistory: [{
  //   sessionId: mongoose.Schema.Types.ObjectId,
  //   amountRedeemed: Number,
  //   redeemedAt: Date,
  // }],
}, { timestamps: true });

// Helper to generate a unique redemption code (simple version)
// For a more robust solution, consider libraries like 'nanoid' or 'shortid'
giftCardSchema.statics.generateRedemptionCode = function() {
  // Example: GC- followed by 8 random alphanumeric characters
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'GC-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
  // Ensure this code is checked for uniqueness in the database before saving
};

export const GiftCard = mongoose.model('GiftCard', giftCardSchema); 