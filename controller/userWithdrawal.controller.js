// controllers/userWithdrawalController.js
import WithdrawalRequest from '../model/userWithdrawalRequest.model.js';
import { User } from '../model/user.model.js';

// Create withdrawal request - matches your frontend POST /api/withdrawal/request
export const createWithdrawalRequest = async (req, res) => {
  try {
    const { amount, method, bankDetails } = req.body;
    const userId = req.user.id; // From auth middleware

    // Basic validation
    if (!amount || amount < 10) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be at least 10 SAR'
      });
    }

    if (!method || !['bank', 'tap'].includes(method)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal method'
      });
    }

    // Get user's current wallet balance
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has sufficient balance
    if (!user.walletBalance || user.walletBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    // If bank method, validate bank details
    if (method === 'bank') {
      const { accountNumber, routingNumber, bankName, accountHolderName } = bankDetails || {};
      if (!accountNumber || !routingNumber || !bankName || !accountHolderName) {
        return res.status(400).json({
          success: false,
          message: 'All bank details are required for bank transfer'
        });
      }
    }

    // Create withdrawal request
    const withdrawalRequest = new WithdrawalRequest({
      userId,
      amount,
      method,
      bankDetails: method === 'bank' ? bankDetails : undefined,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await withdrawalRequest.save();

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        requestId: withdrawalRequest._id,
        status: withdrawalRequest.status,
        amount: withdrawalRequest.amount,
        method: withdrawalRequest.method,
        createdAt: withdrawalRequest.createdAt
      }
    });

  } catch (error) {
    console.error('Error creating withdrawal request:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user's withdrawal history - matches your frontend GET /api/withdrawal/history
export const getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all withdrawal requests for this user
    const withdrawals = await WithdrawalRequest.find({ userId })
      .sort({ createdAt: -1 }) // Latest first
      .select('-ipAddress -userAgent'); // Don't send sensitive data

    res.status(200).json({
      success: true,
      data: withdrawals
    });

  } catch (error) {
    console.error('Error fetching withdrawal history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};