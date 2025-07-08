// controllers/userWalletController.js
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import axios from 'axios';
import { User } from "../model/user.model.js";
import Transaction from "../model/transaction.model.js";
import { UserToExpertSession } from "../model/usertoexpertsession.model.js";
import dotenv from 'dotenv'
dotenv.config();
// HyperPay API endpoints and credentials
const HYPERPAY_API_URL = process.env.HYPERPAY_API_URL;
const HYPERPAY_ACCESS_TOKEN = process.env.HYPERPAY_ACCESS_TOKEN;
const HYPERPAY_ENTITY_ID_VISA_MASTER = process.env.HYPERPAY_ENTITY_ID_VISA_MASTER;
const HYPERPAY_ENTITY_ID_MADA = process.env.HYPERPAY_ENTITY_ID_MADA;

/**
 * Get user wallet balance
 */
export const getWalletBalance = asyncHandler(async (req, res) => {
  const user = req.user;
  
  if (!user) {
    throw new ApiError(401, "User not found or unauthorized");
  }
  
  return res.status(200).json({ 
    success: true, 
    data: { 
      balance: user.walletBalance || 0,
      currency: 'SAR' 
    } 
  });
});

/**
 * Create payment checkout for wallet top-up
 */
export const createPaymentIntent = asyncHandler(async (req, res) => {
  const { amount, paymentMethod = 'VISA_MASTER' } = req.body;
  const user = req.user;

  if (!amount || isNaN(amount) || amount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  if (!user) {
    throw new ApiError(401, "User not found or unauthorized");
  }

  const merchantTransactionId = `pay-${user._id}-${Date.now()}`;
   const entityId =
    paymentMethod === "MADA"
      ? HYPERPAY_ENTITY_ID_MADA
      : HYPERPAY_ENTITY_ID_VISA_MASTER;

  try {
    const checkoutData = {
      entityId,
      amount: parseFloat(amount).toFixed(2),
      currency: 'SAR',
      paymentType: 'DB',
      merchantTransactionId,

      'customer.email': user.email,
      'customer.givenName': user.firstName || 'User',
      'customer.surname': user.lastName || 'Customer',

      'billing.street1': user.address?.street || 'Default Street',
      'billing.city': user.address?.city || 'Riyadh',
      'billing.state': user.address?.state || 'Riyadh Province',
      'billing.country': user.address?.country || 'SA',
      'billing.postcode': user.address?.postcode || '12345',

      // Required for 3DS2 testing
      // 'customParameters[3DS2_enrolled]': 'true',
      // 'customParameters[3DS2_flow]': 'challenge',
      
      notificationUrl: `${process.env.API_URL}/api/user/wallet/webhook`,
    };

    const formData = new URLSearchParams();
    for (const key in checkoutData) {
      formData.append(key, checkoutData[key]);
    }

    const { data } = await axios.post(
      `${HYPERPAY_API_URL}/v1/checkouts`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${HYPERPAY_ACCESS_TOKEN}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (data.result.code !== '000.000.000' && !data.result.code.startsWith('000.200')) {
      throw new ApiError(400, `HyperPay Error: ${data.result.description}`);
    }

    const checkoutId = data.id;

    const transaction = await Transaction.create({
      userId: user._id,
      type: 'DEPOSIT',
      amount: parseFloat(amount),
      paymentId: checkoutId,
      paymentMethod: 'HYPERPAY',
      status: 'PENDING',
      description: 'Session Booking',
      metadata: {
        hyperPayCheckoutId: checkoutId,
        merchantTransactionId,
        entityId,
        paymentType: paymentMethod
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        checkoutId,
        transactionId: transaction._id,
        entityId,
      }
    });
  } catch (error) {
    console.error('HyperPay Checkout Error:', error?.response?.data || error.message);
    throw new ApiError(
      500,
      "Payment initiation failed: " +
        (error?.response?.data?.result?.description || error.message)
    );
  }
});

export const verifyPayment = asyncHandler(async (req, res) => {
  let { checkoutId, resourcePath } = req.query;

  if (!checkoutId && !resourcePath) {
    return res.status(400).json({
      success: false,
      message: 'Missing checkoutId or resourcePath'
    });
  }

  const fullCheckoutId = checkoutId || resourcePath?.split('/').pop() || '';
  console.log(`Using full checkoutId: ${fullCheckoutId}`);

  const transaction = await Transaction.findOne({
    $or: [
      { paymentId: fullCheckoutId },
      { 'metadata.hyperPayCheckoutId': fullCheckoutId }
    ]
  });

  if (!transaction) {
    return res.status(404).json({
      success: false,
      message: 'Transaction record not found'
    });
  }

  const entityId = transaction.metadata?.entityId || HYPERPAY_ENTITY_ID_VISA_MASTER;
  const statusUrl = `${HYPERPAY_API_URL}/v1/checkouts/${fullCheckoutId}/payment?entityId=${entityId}`;

  try {
    const statusResponse = await axios.get(statusUrl, {
      headers: {
        'Authorization': `Bearer ${HYPERPAY_ACCESS_TOKEN}`
      }
    });

    const paymentData = statusResponse.data;
    const resultCode = paymentData.result.code;

    const isSuccessful =
      resultCode === '000.000.000' ||
      resultCode === '000.000.100' ||
      /^000\.000\.(0[0-9][0-9]|100)$/.test(resultCode);

    if (isSuccessful) {
      console.log(`Payment ${fullCheckoutId} was successful.`);

      if (transaction.status === 'COMPLETED') {
        return res.status(200).json({
          success: true,
          message: 'Payment already processed',
          data: {
            status: 'COMPLETED',
            amount: transaction.amount,
            transactionId: transaction._id
          }
        });
      }

      transaction.status = 'COMPLETED';
      transaction.metadata = {
        ...transaction.metadata,
        hyperPayResult: paymentData.result,
        paymentId: paymentData.id
      };
      await transaction.save();

      const user = await User.findById(transaction.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      user.walletBalance = (user.walletBalance || 0) + transaction.amount;
      user.transactions = user.transactions || [];
      if (!user.transactions.includes(transaction._id)) {
        user.transactions.push(transaction._id);
      }

      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Payment successfully processed',
        data: {
          status: 'COMPLETED',
          amount: transaction.amount,
          transactionId: transaction._id,
          newBalance: user.walletBalance,
          hyperPayResult: paymentData.result
        }
      });
    } else {
      console.log(`Payment ${fullCheckoutId} failed with code: ${resultCode}`);

      transaction.status = 'FAILED';
      transaction.metadata = {
        ...transaction.metadata,
        hyperPayResult: paymentData.result
      };
      await transaction.save();

      return res.status(200).json({
        success: false,
        message: 'Payment was not successful',
        data: {
          status: 'FAILED',
          reason: paymentData.result.description,
          code: resultCode
        }
      });
    }
  } catch (error) {
    console.error('Error checking payment status:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Payment status check failed',
      error: error.response?.data || error.message
    });
  }
});

/**
 * Handle webhook notifications from HyperPay
 */
export const webhookHandler = asyncHandler(async (req, res) => {
  try {
    const event = req.body;
    console.log('HyperPay webhook received:', event);
    
    const checkoutId = event.checkoutId || event.id;
    const merchantTransactionId = event.merchantTransactionId;
    
    const transaction = await Transaction.findOne({ 
      $or: [
        { paymentId: checkoutId },
        { 'metadata.merchantTransactionId': merchantTransactionId }
      ]
    });
    
    if (!transaction) {
      console.log(`Transaction not found for checkoutId: ${checkoutId} or merchantTransactionId: ${merchantTransactionId}`);
      return res.status(200).end();
    }

    const entityId = transaction.metadata?.entityId || HYPERPAY_ENTITY_ID_VISA_MASTER;
    const statusResponse = await axios.get(
      `${HYPERPAY_API_URL}/v1/checkouts/${checkoutId}/payment?entityId=${entityId}`,
      {
        headers: {
          'Authorization': `Bearer ${HYPERPAY_ACCESS_TOKEN}`
        }
      }
    );
    
    const paymentData = statusResponse.data;
    const isSuccessful = paymentData.result.code === '000.000.000' || 
                        paymentData.result.code === '000.000.100' ||
                        paymentData.result.code.match(/^000\.000\.(0[0-9][0-9]|100)$/);
    
    if (isSuccessful && transaction.status !== 'COMPLETED') {
      transaction.status = 'COMPLETED';
      transaction.metadata = {
        ...transaction.metadata,
        hyperPayResult: paymentData.result,
        webhookProcessed: true
      };
      await transaction.save();
      
      const user = await User.findById(transaction.userId);
      if (user) {
        user.walletBalance = (user.walletBalance || 0) + transaction.amount;
        
        if (!user.transactions?.includes(transaction._id)) {
          user.transactions = [...(user.transactions || []), transaction._id];
        }
        
        await user.save();
        console.log(`Webhook: Updated user ${user._id} wallet balance to ${user.walletBalance}`);
      }
    } else if (!isSuccessful) {
      transaction.status = 'FAILED';
      transaction.metadata = {
        ...transaction.metadata,
        hyperPayResult: paymentData.result,
        webhookProcessed: true
      };
      await transaction.save();
      console.log(`Webhook: Payment failed for transaction ${transaction._id}`);
    }
    
    return res.status(200).end();
  } catch (error) {
    console.error('Error processing HyperPay webhook:', error);
    return res.status(200).end();
  }
});

/**
 * Get transaction history for the user
 */
export const getTransactionHistory = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { page = 1, limit = 10, type } = req.query;
  
  if (!userId) {
    throw new ApiError(401, "User not found or unauthorized");
  }
  
  const query = { userId: userId };
  
  if (type) {
    query.type = type.toUpperCase();
  }
  
  const options = {
    sort: { createdAt: -1 },
    limit: parseInt(limit),
    skip: (parseInt(page) - 1) * parseInt(limit)
  };
  
  const transactions = await Transaction.find(query, null, options);
  const total = await Transaction.countDocuments(query);
  
  return res.status(200).json({
    success: true,
    data: {
      transactions,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit)
      }
    }
  });
});

/**
 * Process a wallet payment for booking a session
 */
export const processWalletPayment = asyncHandler(async (req, res) => {
  const { sessionId, amount } = req.body;
  const user = req.user;
  
  if (!sessionId || !amount || amount <= 0) {
    throw new ApiError(400, "Invalid request parameters");
  }
  
  if (!user) {
    throw new ApiError(401, "User not found or unauthorized");
  }
  
  if ((user.walletBalance || 0) < amount) {
    throw new ApiError(400, "Insufficient wallet balance");
  }
  
  const transaction = await Transaction.create({
    userId: user._id,
    type: 'PAYMENT',
    amount,
    status: 'COMPLETED',
    paymentMethod: 'WALLET',
    description: `Payment for session #${sessionId}`,
    metadata: { sessionId }
  });
  
  user.walletBalance -= amount;
  
  if (!user.transactions?.includes(transaction._id)) {
    user.transactions = [...(user.transactions || []), transaction._id];
  }
  
  await user.save();
  
  console.log(`[User Wallet] User ${user._id} wallet updated. Attempting to update session ${sessionId}.`);

  const sessionRecord = await UserToExpertSession.findById(sessionId);
  if (sessionRecord && sessionRecord.paymentStatus === 'completed') {
    return res.status(200).json({
      success: true,
      message: 'Payment already processed for this session',
      data: {
        newBalance: user.walletBalance,
        sessionId
      }
    });
  }

  try {
    const sessionToUpdate = await UserToExpertSession.findById(sessionId);
    if (sessionToUpdate) {
      sessionToUpdate.paymentStatus = 'completed';
      sessionToUpdate.paymentMethod = 'wallet';
      await sessionToUpdate.save();
      console.log(`[User Wallet] Session ${sessionId} updated.`);
    } else {
      console.error(`[User Wallet] Session with ID ${sessionId} not found`);
    }
  } catch (sessionUpdateError) {
    console.error(`[User Wallet] Error updating session:`, sessionUpdateError);
  }

  return res.status(200).json({
    success: true,
    data: {
      transaction: transaction._id,
      newBalance: user.walletBalance,
      message: 'Payment processed successfully'
    }
  });
});

export default {
  getWalletBalance,
  createPaymentIntent,
  verifyPayment,
  webhookHandler,
  getTransactionHistory,
  processWalletPayment
};