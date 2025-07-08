// model/transaction.model.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    expertId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Expert',
    required: function() {
      return !this.userId; // expertId is required only if userId is not provided
    }
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return !this.expertId; // userId is required only if expertId is not provided
    }
  },
    type: {
      type: String,
      enum: ['DEPOSIT', 'WITHDRAWAL', 'PAYMENT', 'REFUND'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'SAR'
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'PENDING'
    },
    paymentMethod: {
      type: String,
      enum: ['TAP', 'WALLET', 'HYPERPAY'],
      default: 'TAP'
    },
    paymentId: {
      type: String
    },
    description: {
      type: String
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);