// models/expertWithdrawalRequest.js
import mongoose from 'mongoose';

const expertWithdrawalRequestSchema = new mongoose.Schema({
  expertId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Expert', // assuming experts are also users with a role
    required: true
  },
  amount: { type: Number, required: true, min: 10 },
  method: { type: String, enum: ['bank', 'tap'], required: true },
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
    ref: 'Expert'
  },
  reviewedAt: Date,
  processedAt: Date,
  refundId: String,
  transactionId: String,
  ipAddress: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

expertWithdrawalRequestSchema.index({ expertId: 1, createdAt: -1 });
expertWithdrawalRequestSchema.index({ status: 1, createdAt: -1 });

expertWithdrawalRequestSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// export default mongoose.model('ExpertWithdrawalRequest', expertWithdrawalRequestSchema);
export const ExpertWithdrawalRequest = mongoose.models.ExpertWithdrawalRequest || mongoose.model("ExpertWithdrawalRequest", expertWithdrawalRequestSchema);
