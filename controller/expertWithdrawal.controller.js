// controllers/expertWithdrawalController.js
import { Expert } from '../model/expert.model.js';
import { ExpertWithdrawalRequest } from '../model/expertWithdrawalRequest.model.js';
import Transaction from '../model/transaction.model.js'; // Import Transaction model
import axios from 'axios';
import nodemailer from 'nodemailer';

const createexpertWithdrawalRequest = async (req, res) => {
  try {
    const { amount, method, bankDetails } = req.body;
    const expertId = req.user?._id; // authenticated expert

    if (!amount || amount < 10) {
      return res.status(400).json({ success: false, message: 'Amount must be at least 10 SAR' });
    }

    if (method !== 'bank') {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal method. Only bank transfers are allowed.' });
    }

    const expert = await Expert.findById(expertId);
    if (!expert || expert.role !== 'expert') {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }

    if (!expert.wallets.earning.balance || expert.wallets.earning.balance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    const { accountNumber, routingNumber, bankName, accountHolderName } = bankDetails || {};
    if (!accountNumber || !routingNumber || !bankName || !accountHolderName) {
      return res.status(400).json({ success: false, message: 'All bank details are required' });
    }

    // // Deduct the amount immediately from expert's wallet
    // expert.walletBalance -= amount;
    // await expert.save();

    const newRequest = new ExpertWithdrawalRequest({
      expertId,
      amount,
      method: 'bank',
      bankDetails,
      status: 'pending', // All bank transfers require admin processing
      ipAddress: req.ip,
      expertAgent: req.get('Expert-Agent')
    });

    await newRequest.save();

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully and will be processed by the admin.',
      data: {
        requestId: newRequest._id,
        status: newRequest.status,
        amount: newRequest.amount,
        method: newRequest.method,
        createdAt: newRequest.createdAt
      }
    });
  } catch (err) {
    console.error('Error in expert withdrawal:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


// Simple TAP refund - just find the most recent deposit and refund the exact amount
const processSimpleTAPRefund = async (expert, withdrawalAmount) => {
  try {
    // Find the most recent completed TAP deposit for the user
    const transaction = await Transaction.findOne({
      expertId: expert._id,
      type: 'DEPOSIT',
      paymentMethod: 'TAP',
      status: 'COMPLETED',
      'metadata.tapChargeId': { $exists: true },
    }).sort({ createdAt: -1 });

    if (!transaction) {
      return {
        success: false,
        message: 'No TAP deposit transaction found to refund',
      };
    }

    console.log('Transaction found:', transaction);

    // Prepare refund payload - refund the exact withdrawal amount
    const refundPayload = {
      charge_id: transaction.metadata.tapChargeId,
      amount: withdrawalAmount,
      currency: transaction.currency || 'SAR',
      reason: 'Expert withdrawal refund to original payment method',
      metadata: {
        expertId: expert._id.toString(),
        expertWithdrawalAmount: withdrawalAmount,
      },
      reference: {
        merchant: `withdraw-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      },
    };

    console.log('Refund payload:', JSON.stringify(refundPayload, null, 2));

    // Send refund request to TAP
    const tapResponse = await axios.post('https://api.tap.company/v2/refunds/', refundPayload, {
      headers: {
        Authorization: `Bearer ${process.env.TAP_SECRET_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    console.log('TAP refund successful:', tapResponse.data);

    // Update wallet and create refund transaction record
    expert.walletBalance -= withdrawalAmount;
    await expert.save();

    // Create refund transaction record
    const refundTransaction = new Transaction({
      expertId: expert._id,
      type: 'REFUND',
      amount: withdrawalAmount,
      currency: transaction.currency || 'SAR',
      status: 'COMPLETED',
      paymentMethod: 'TAP',
      metadata: {
        tapRefundId: tapResponse.data.id,
        originalChargeId: transaction.metadata.tapChargeId,
        refundReason: 'expert_withdrawal'
      }
    });

    await refundTransaction.save();

    // Send confirmation email
    try {
      await sendSimpleRefundConfirmation(expert, withdrawalAmount, tapResponse.data.id);
    } catch (emailError) {
      console.error('Failed to send refund confirmation email:', emailError);
    }

    return {
      success: true,
      transferReference: `TAP-REFUND-${tapResponse.data.id}`,
      transactionDetails: {
        method: 'TAP Refund',
        amount: withdrawalAmount,
        tapRefundId: tapResponse.data.id,
        originalChargeId: transaction.metadata.tapChargeId,
        estimatedDelivery: '3-7 business days',
        status: 'Completed'
      }
    };

  } catch (error) {
    console.error('Error processing TAP refund:', error.response?.data || error.message);
    return {
      success: false,
      message: `Failed to process TAP refund: ${error.response?.data?.errors?.[0]?.description || error.message}`
    };
  }
};

// Send simple refund confirmation email
const sendSimpleRefundConfirmation = async (expert, amount, tapRefundId) => {
  try {
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: expert.email,
      subject: 'Withdrawal Refund Processed',
      html: `
        <h2>TAP Refund Confirmation</h2>
        <p>Dear ${expert.firstName} ${expert.lastName},</p>
        <p>Your withdrawal request has been processed via TAP refund.</p>
        
        <h3>Refund Details:</h3>
        <ul>
          <li><strong>Amount:</strong> ${amount} SAR</li>
          <li><strong>Method:</strong> TAP Refund to Original Payment Method</li>
          <li><strong>TAP Refund ID:</strong> ${tapRefundId}</li>
          <li><strong>Estimated Delivery:</strong> 3-7 business days</li>
        </ul>
        
        <p>The refund will be credited back to your original payment method used for TAP deposits.</p>
        <p>If you don't see the refund within 7 business days, please contact our support team.</p>
        
        <p>Best regards,<br>Your Company Team</p>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending refund confirmation email:', error);
  }
};


 const getExpertWithdrawalHistory = async (req, res) => {
  try {
      const expertId = req.user?._id;

    const withdrawals = await ExpertWithdrawalRequest.find({ expertId })
      .sort({ createdAt: -1 })
      .select('-ipAddress -expertAgent');

    return res.status(200).json({ success: true, data: withdrawals });

  } catch (err) {
    console.error('Error fetching expert withdrawal history:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};



export {createexpertWithdrawalRequest, getExpertWithdrawalHistory}
