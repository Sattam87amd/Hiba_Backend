// models/WithdrawalRequest.js
import mongoose from 'mongoose';

const withdrawalRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 10
  },
  method: {
    type: String,
    enum: ['bank', 'tap'],
    required: true
  },
  bankDetails: {
    accountNumber: String,
    routingNumber: String,
    bankName: String,
    accountHolderName: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  adminComments: String,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Referencing User model (admin is also a user with role)
  },
  reviewedAt: Date,
  processedAt: Date,
  refundId: String, // TAP refund ID when processed
  transactionId: String, // Original charge ID for TAP refunds
  
  // Metadata
  ipAddress: String,
  userAgent: String,
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
withdrawalRequestSchema.index({ userId: 1, createdAt: -1 });
withdrawalRequestSchema.index({ status: 1, createdAt: -1 });

// Update the updatedAt field before saving
withdrawalRequestSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('WithdrawalRequest', withdrawalRequestSchema);