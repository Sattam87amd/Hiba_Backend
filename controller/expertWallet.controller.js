// controllers/WalletController.js
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import axios from 'axios';
import { Expert } from "../model/expert.model.js";
import { Transaction } from "../model/transaction.model.js";
import { ExpertToExpertSession } from "../model/experttoexpertsession.model.js";
import { UserToExpertSession } from "../model/usertoexpertsession.model.js";

// HyperPay API endpoints and credentials
const HYPERPAY_API_URL = 'https://eu-test.oppwa.com';
const HYPERPAY_ACCESS_TOKEN = 'OGFjN2E0Yzk5NzdiY2YxMTAxOTc3ZGNlNzYyODAzODV8I0ZNRiN5dHhZeiUzPXpEb2NZNmY=';
const HYPERPAY_ENTITY_ID_VISA_MASTER = '8ac7a4c9977bcf1101977dcef9cd0389';
const HYPERPAY_ENTITY_ID_MADA = '8ac7a4c9977bcf1101977dd10db4038e';

/**
 * Get expert wallet balance
 */
export const getWalletBalance = asyncHandler(async (req, res) => {
  // Get expert from the request (set by your auth middleware)
  const expert = req.user;
  
  if (!expert) {
    throw new ApiError(401, "Expert not found or unauthorized");
  }
  
  // Return wallet balance (initialize to 0 if not set)
  return res.status(200).json({ 
    success: true, 
    data: { 
      balance: expert.walletBalance || 0,
      currency: 'SAR' 
    } 
  });
});

/**
 * Create payment checkout for wallet top-up
 */
export const createPaymentIntent = asyncHandler(async (req, res) => {
  const { amount, paymentMethod = 'VISA_MASTER', walletType = 'walletBalance' } = req.body;
  const expert = req.user;

  if (!amount || isNaN(amount) || amount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  if (!expert) {
    throw new ApiError(401, "Expert not found or unauthorized");
  }

  const merchantTransactionId = `topup-${expert._id}-${Date.now()}`;
  const entityId = HYPERPAY_ENTITY_ID_VISA_MASTER;
  // console.log("Shopper result URL is:", checkoutData.shopperResultUrl);

  try {
    const checkoutData = {
      entityId,
      amount: parseFloat(amount).toFixed(2),
      currency: 'SAR',
      paymentType: 'DB',
      merchantTransactionId,

      'customer.email': expert.email,
      'customer.givenName': expert.firstName || 'Expert',
      'customer.surname': expert.lastName || 'User',

      'billing.street1': expert.address?.street || 'Default Street',
      'billing.city': expert.address?.city || 'Riyadh',
      'billing.state': expert.address?.state || 'Riyadh Province',
      'billing.country': expert.address?.country || 'SA',
      'billing.postcode': expert.address?.postcode || '12345',

      // Required for 3DS2 testing
      'customParameters[3DS2_enrolled]': 'true',
      'customParameters[3DS2_flow]': 'challenge',
      

      notificationUrl: `${process.env.API_URL}/api/wallet/webhook`,
    
    };

      console.log('checkoutData:', checkoutData);


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
      expertId: expert._id,
      type: 'DEPOSIT',
      amount: parseFloat(amount),
      paymentId: checkoutId,
      paymentMethod: 'HYPERPAY',
      status: 'PENDING',
      description: 'Wallet top-up',
      metadata: {
        hyperPayCheckoutId: checkoutId,
        merchantTransactionId,
        entityId,
        paymentType: paymentMethod,
        walletType
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        checkoutId,
        transactionId: transaction._id,
        entityId,
        testMode: true
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

// Wrapper for spending wallet top-ups so FE can hit /spending/topup without needing to send walletType
export const createSpendingTopup = asyncHandler(async (req, res, next) => {
  req.body.walletType = 'spending';
  return createPaymentIntent(req, res, next);
});

export const verifyPayment = asyncHandler(async (req, res) => {
  let { checkoutId, resourcePath } = req.query;

  if (!checkoutId && !resourcePath) {
    return res.status(400).json({
      success: false,
      message: 'Missing checkoutId or resourcePath'
    });
  }

  // ✅ Use the full, unmodified checkout ID
  const fullCheckoutId = checkoutId || resourcePath?.split('/').pop() || '';
  console.log(`Using full checkoutId: ${fullCheckoutId}`);

  // ✅ Look up transaction using the full ID
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

  console.log('Checking payment status from URL:', statusUrl);

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

      const expert = await Expert.findById(transaction.expertId);
      if (!expert) {
        return res.status(404).json({
          success: false,
          message: 'Expert not found'
        });
      }

      await topUpWallet({ expert, amount: transaction.amount, walletType: transaction.metadata.walletType, transactionId: transaction._id });

      return res.status(200).json({
        success: true,
        message: 'Payment successfully processed',
        data: {
          status: 'COMPLETED',
          amount: transaction.amount,
          transactionId: transaction._id,
          newBalance: expert.walletBalance,
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
    
    // Extract payment information from webhook
    const checkoutId = event.checkoutId || event.id;
    const merchantTransactionId = event.merchantTransactionId;
    
    // Find the transaction in our database
    const transaction = await Transaction.findOne({ 
      $or: [
        { paymentId: checkoutId },
        { 'metadata.merchantTransactionId': merchantTransactionId }
      ]
    });
    
    if (!transaction) {
      console.log(`Transaction not found for checkoutId: ${checkoutId} or merchantTransactionId: ${merchantTransactionId}`);
      return res.status(200).end(); // Acknowledge receipt
    }

    // Verify the payment status with HyperPay API
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
      // Payment completed successfully
      transaction.status = 'COMPLETED';
      transaction.metadata = {
        ...transaction.metadata,
        hyperPayResult: paymentData.result,
        webhookProcessed: true
      };
      await transaction.save();
      
      // Update expert wallet balance
      const expert = await Expert.findById(transaction.expertId);
      if (expert) {
        await topUpWallet({ expert, amount: transaction.amount, walletType: transaction.metadata.walletType, transactionId: transaction._id });
        console.log(`Webhook: Updated expert ${expert._id} wallet balance to ${expert.walletBalance}`);
      }
    } else if (!isSuccessful) {
      // Payment failed
      transaction.status = 'FAILED';
      transaction.metadata = {
        ...transaction.metadata,
        hyperPayResult: paymentData.result,
        webhookProcessed: true
      };
      await transaction.save();
      console.log(`Webhook: Payment failed for transaction ${transaction._id}`);
    }
    
    // Always return 200 to acknowledge receipt
    return res.status(200).end();
  } catch (error) {
    console.error('Error processing HyperPay webhook:', error);
    return res.status(200).end(); // Always acknowledge receipt to prevent retries
  }
});

/**
 * Get transaction history for the expert
 */
export const getTransactionHistory = asyncHandler(async (req, res) => {
  const expertId = req.user?._id;
  const { page = 1, limit = 10, type } = req.query;
  
  if (!expertId) {
    throw new ApiError(401, "Expert not found or unauthorized");
  }
  
  const query = { expertId: expertId };
  
  // Filter by transaction type if provided
  if (type) {
    query.type = type.toUpperCase();
  }
  
  const options = {
    sort: { createdAt: -1 }, // Sort by latest first
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
  const expert = req.user;
  
  if (!sessionId || !amount || amount <= 0) {
    throw new ApiError(400, "Invalid request parameters");
  }
  
  if (!expert) {
    throw new ApiError(401, "Expert not found or unauthorized");
  }
  
  // Check if expert has sufficient balance
  if ((expert.walletBalance || 0) < amount) {
    throw new ApiError(400, "Insufficient wallet balance");
  }
  
  // Create transaction record
  const transaction = await Transaction.create({
    expertId: expert._id,
    type: 'PAYMENT',
    amount,
    status: 'COMPLETED',
    paymentMethod: 'WALLET',
    description: `Payment for session #${sessionId}`,
    metadata: { sessionId }
  });
  
  // Deduct from wallet balance
  expert.walletBalance -= amount;
  
  // Add transaction to expert's transactions array
  if (!expert.transactions?.includes(transaction._id)) {
    expert.transactions = [...(expert.transactions || []), transaction._id];
  }
  
  await expert.save();
  
  console.log(`[WalletPayment] Expert ${expert._id} wallet updated. Attempting to update session ${sessionId}.`);

  // Update the session that was paid for
  try {
    let sessionToUpdate = await ExpertToExpertSession.findById(sessionId);
    if (sessionToUpdate) {
      console.log(`[WalletPayment] Found ExpertToExpertSession ${sessionId} to update.`);
      sessionToUpdate.paymentStatus = 'completed';
      sessionToUpdate.paymentMethod = 'wallet';
      await sessionToUpdate.save();
      console.log(`[WalletPayment] ExpertToExpertSession ${sessionId} updated. Status: ${sessionToUpdate.paymentStatus}, Method: ${sessionToUpdate.paymentMethod}`);
    } else {
      sessionToUpdate = await UserToExpertSession.findById(sessionId);
      if (sessionToUpdate) {
        console.log(`[WalletPayment] Found UserToExpertSession ${sessionId} to update.`);
        sessionToUpdate.paymentStatus = 'completed';
        sessionToUpdate.paymentMethod = 'wallet';
        await sessionToUpdate.save();
        console.log(`[WalletPayment] UserToExpertSession ${sessionId} updated. Status: ${sessionToUpdate.paymentStatus}, Method: ${sessionToUpdate.paymentMethod}`);
      } else {
        console.error(`[WalletPayment] Session with ID ${sessionId} not found in E2E or U2E collections to update payment status after wallet payment.`);
      }
    }
  } catch (sessionUpdateError) {
    console.error(`[WalletPayment] Error updating session ${sessionId} after wallet payment:`, sessionUpdateError);
  }

  // Return success response
  return res.status(200).json({
    success: true,
    data: {
      transaction: transaction._id,
      newBalance: expert.walletBalance,
      message: 'Payment processed successfully'
    }
  });
});

const topUpWallet = async ({ expert, amount, walletType = 'walletBalance', transactionId }) => {
  if (!expert) return;
  if (walletType === 'spending') {
    expert.wallets = expert.wallets || { earning: { balance: 0 }, spending: { balance: 0 } };
    expert.wallets.spending.balance = (expert.wallets.spending.balance || 0) + amount;
    expert.wallets.spending.ledger = expert.wallets.spending.ledger || [];
    expert.wallets.spending.ledger.push(transactionId);
  } else if (walletType === 'earning') {
    expert.wallets = expert.wallets || { earning: { balance: 0 }, spending: { balance: 0 } };
    expert.wallets.earning.balance = (expert.wallets.earning.balance || 0) + amount;
    expert.wallets.earning.ledger = expert.wallets.earning.ledger || [];
    expert.wallets.earning.ledger.push(transactionId);
  } else {
    // legacy single wallet
    expert.walletBalance = (expert.walletBalance || 0) + amount;
  }
  // keep global transactions array for backward compatibility
  expert.transactions = expert.transactions || [];
  if (!expert.transactions.includes(transactionId)) {
    expert.transactions.push(transactionId);
  }
  await expert.save();
};

/**
 * Get both earning and spending wallet balances
 */
export const getWalletBalances = asyncHandler(async (req, res) => {
  const expert = req.user;
  if (!expert) throw new ApiError(401, 'Expert not found or unauthorized');

  // Ensure wallets structure exists
  expert.wallets = expert.wallets || { earning: { balance: 0 }, spending: { balance: 0 } };
  const { earning, spending } = expert.wallets;
  return res.status(200).json({ success: true, data: { earning: earning.balance || 0, spending: spending.balance || 0 } });
});

/**
 * Debit spending wallet of payer and credit earning wallet of payee
 */
export const payAnotherExpert = asyncHandler(async (req, res) => {
  const payer = req.user; // authenticated expert A
  const { sessionId, amount, payeeExpertId } = req.body;

  if (!sessionId || !amount || amount <= 0 || !payeeExpertId) {
    throw new ApiError(400, 'Invalid payload');
  }
  if (!payer) throw new ApiError(401, 'Unauthorized');

  // Load full documents with wallets balances
  const payerDoc = await Expert.findById(payer._id);
  const payeeDoc = await Expert.findById(payeeExpertId);
  if (!payeeDoc) throw new ApiError(404, 'Payee expert not found');

  payerDoc.wallets = payerDoc.wallets || { earning: { balance: 0 }, spending: { balance: 0 } };
  payeeDoc.wallets = payeeDoc.wallets || { earning: { balance: 0 }, spending: { balance: 0 } };

  if ((payerDoc.wallets.spending.balance || 0) < amount) {
    throw new ApiError(400, 'INSUFFICIENT_FUNDS');
  }

  // Perform atomic-like update using session if desired; here simple sequential update
  payerDoc.wallets.spending.balance -= amount;
  payeeDoc.wallets.earning.balance += amount;

  // Create ledger entries (Transactions)
  const [debitTx, creditTx] = await Transaction.insertMany([
    {
      expertId: payerDoc._id,
      type: 'PAYMENT',
      amount,
      status: 'COMPLETED',
      paymentMethod: 'WALLET',
      description: `Spending debit for session ${sessionId}`,
      metadata: { sessionId, walletType: 'spending', direction: 'debit', to: payeeExpertId }
    },
    {
      expertId: payeeDoc._id,
      type: 'DEPOSIT',
      amount,
      status: 'COMPLETED',
      paymentMethod: 'WALLET',
      description: `Earning credit from expert ${payerDoc._id} session ${sessionId}`,
      metadata: { sessionId, walletType: 'earning', direction: 'credit', from: payerDoc._id }
    }
  ]);

  // push ledger ids
  payerDoc.wallets.spending.ledger = payerDoc.wallets.spending.ledger || [];
  payerDoc.wallets.spending.ledger.push(debitTx._id);
  payeeDoc.wallets.earning.ledger = payeeDoc.wallets.earning.ledger || [];
  payeeDoc.wallets.earning.ledger.push(creditTx._id);

  await Promise.all([payerDoc.save(), payeeDoc.save()]);

  return res.status(200).json({ success: true, data: { newSpendingBalance: payerDoc.wallets.spending.balance, earningCredited: amount } });
});

/**
 * Credit earning wallet (internal use)
 */
export const creditEarningWallet = asyncHandler(async (req, res) => {
  const { expertId, amount, sessionId } = req.body;
  if (!expertId || !amount || amount <= 0) throw new ApiError(400, 'Invalid payload');

  const expert = await Expert.findById(expertId);
  if (!expert) throw new ApiError(404, 'Expert not found');
  expert.wallets = expert.wallets || { earning: { balance: 0 }, spending: { balance: 0 } };
  expert.wallets.earning.balance += amount;

  const tx = await Transaction.create({
    expertId,
    type: 'DEPOSIT',
    amount,
    status: 'COMPLETED',
    paymentMethod: 'WALLET',
    description: `Earning credit${sessionId ? ' for session ' + sessionId : ''}`,
    metadata: { walletType: 'earning', sessionId }
  });
  expert.wallets.earning.ledger = expert.wallets.earning.ledger || [];
  expert.wallets.earning.ledger.push(tx._id);
  await expert.save();

  return res.status(200).json({ success: true, data: { newEarningBalance: expert.wallets.earning.balance } });
});

/**
 * Get earning wallet history with session/user info
 */
export const getEarningWalletHistory = asyncHandler(async (req, res) => {
  const expertId = req.user?._id;
  if (!expertId) throw new ApiError(401, 'Expert not found or unauthorized');

  // Find DEPOSIT transactions for this expert
  const transactions = await Transaction.find({
    expertId,
    type: 'DEPOSIT'
  }).sort({ createdAt: -1 });

  // For each transaction, try to get session/user info
  const results = await Promise.all(transactions.map(async (tx) => {
    let session = null;
    let userName = null;
    let sessionTitle = null;
    if (tx.metadata?.sessionId) {
      // Try user-to-expert session first
      session = await (await import('../model/usertoexpertsession.model.js')).UserToExpertSession.findById(tx.metadata.sessionId).populate('userId', 'firstName lastName');
      if (!session) {
        // Try expert-to-expert session
        session = await (await import('../model/experttoexpertsession.model.js')).ExpertToExpertSession.findById(tx.metadata.sessionId).populate('expertId', 'firstName lastName');
      }
      if (session && session.userId && session.userId.firstName) {
        userName = session.userId.firstName + ' ' + session.userId.lastName;
        sessionTitle = session.duration || session.note || session._id;
      } else if (session && session.expertId && session.expertId.firstName) {
        userName = session.expertId.firstName + ' ' + session.expertId.lastName;
        sessionTitle = session.duration || session.note || session._id;
      }
    }
    return {
      dateTime: tx.createdAt,
      sessionId: tx.metadata?.sessionId || '',
      sessionTitle: sessionTitle || tx.description || '',
      userName: userName || '',
      amountEarned: tx.amount,
      finalCredit: tx.amount,
      status: tx.status
    };
  }));
  res.status(200).json({ history: results });
});

/**
 * Get spending wallet history with session/expert info
 */
export const getSpendingWalletHistory = asyncHandler(async (req, res) => {
  const expertId = req.user?._id;
  if (!expertId) throw new ApiError(401, 'Expert not found or unauthorized');

  // Find PAYMENT transactions for this expert
  const transactions = await Transaction.find({
    expertId,
    type: 'PAYMENT'
  }).sort({ createdAt: -1 });

  const results = await Promise.all(transactions.map(async (tx) => {
    let session = null;
    let expertName = null;
    if (tx.metadata?.sessionId) {
      session = await (await import('../model/experttoexpertsession.model.js')).ExpertToExpertSession.findById(tx.metadata.sessionId).populate('consultingExpertID', 'firstName lastName');
      if (session && session.consultingExpertID && session.consultingExpertID.firstName) {
        expertName = session.consultingExpertID.firstName + ' ' + session.consultingExpertID.lastName;
      }
    }
    return {
      dateTime: tx.createdAt,
      sessionId: tx.metadata?.sessionId || '',
      expertName: expertName || '',
      amountPaid: -Math.abs(tx.amount),
      paymentMethod: tx.paymentMethod,
      status: tx.status,
      refundDetails: tx.status === 'REFUNDED' ? (tx.metadata?.refundReason || 'Refunded') : null
    };
  }));
  res.status(200).json({ history: results });
});

export default {
  getWalletBalance,
  createPaymentIntent,
  verifyPayment,
  webhookHandler,
  getTransactionHistory,
  processWalletPayment,
  getWalletBalances,
  payAnotherExpert,
  creditEarningWallet,
  createSpendingTopup,
  getEarningWalletHistory,
  getSpendingWalletHistory
};