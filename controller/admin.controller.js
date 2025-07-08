import { Admin } from '../model/admin.model.js';
import asyncHandler from '../utils/asyncHandler.js'
import ApiError from "../utils/ApiError.js"
import { Expert } from '../model/expert.model.js';
import { UserToExpertSession } from '../model/usertoexpertsession.model.js';
import dotenv from 'dotenv';
import Rating from '../model/rating.model.js';
import nodemailer from 'nodemailer';
import WithdrawalRequest from '../model/userWithdrawalRequest.model.js';
import { ExpertWithdrawalRequest } from '../model/expertWithdrawalRequest.model.js';
import Transaction from '../model/transaction.model.js'; // Import Transaction model
import axios from 'axios';
dotenv.config()

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const loginAdmin = (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ message: 'Email and password are required.' });
  }

  // Simple check against our single user
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    // (Optionally issue a JWT or set a session here)
    return res.status(200).json({ message: 'Login successful!' });
  } else {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }
};

// NEW FUNCTION: Forgot Password
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email is required' 
    });
  }
  
  // Check if the email matches the admin email
  if (email !== process.env.ADMIN_EMAIL) {
    return res.status(404).json({
      success: false,
      message: 'No account found with this email address'
    });
  }
  
  try {
    // Get admin password from environment variable
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    // Prepare email
    const mailOptions = {
      from: `"Admin Panel" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "Your Admin Password",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Admin Password Recovery</h2>
          <p>You requested your admin password. Here are your credentials:</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Password:</strong> ${adminPassword}</p>
          </div>
          <p>Please keep this information secure.</p>
          <p>If you did not request this password, please contact technical support immediately.</p>
        </div>
      `,
    }; 
    
    // Send email
    await transporter.sendMail(mailOptions);
    
    return res.status(200).json({
      success: true,
      message: 'Password has been sent to your email'
    });
    
  } catch (error) {
    console.error('Error sending password email:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send password email',
      error: error.message
    });
  }
});

// Approve or reject an expert
const updateExpertStatus = async (req, res) => {
  const { expertId } = req.params;
  const { status } = req.body;

  // Only allow "Approved" or "Rejected"
  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value' });
  }

  try {
    const updatedExpert = await Expert.findByIdAndUpdate(
      expertId,
      { status },
      { new: true }
    );

    if (!updatedExpert) {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }

    res.status(200).json({
      success: true,
      message: `Expert ${status.toLowerCase()} successfully`,
      data: updatedExpert,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBookingDetails = asyncHandler(async (req, res) => {
  try {
    // Extract user ID from query parameters
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }
    
    // Build filter condition
    
    // Fetch bookings with user filter
    const bookings = await UserToExpertSession.find({ userId }) // Filter by userId, not _id
    .select("areaOfExpertise status amount slots userId");
 
    
    // Format bookings data
    const formattedBookings = bookings.map((booking) => {
      const firstSlot = booking.slots?.[0]?.[0]; // Safely access first slot
      return {
        bookingId: booking._id.toString().slice(-6), // Last 6 chars of ID
        areaOfExpertise: booking.areaOfExpertise || "General Consultation",
        status: booking.status || "Pending",
        amount: booking.amount ? `$${booking.amount}` : "N/A",
        date: firstSlot
          ? `${firstSlot.selectedDate} ${firstSlot.selectedTime}`
          : "No slot available",
      };
    });
    
    res.status(200).json({
      success: true,
      bookings: formattedBookings,
    });
  } catch (error) {
    console.error('Error in getBookingDetails:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch booking details",
      error: error.message
    });
  }
});

const getreview = asyncHandler(async (req, res) => {
  try {
    const feedback = await Rating.find()
      .select("_id expertId raterId rating comment expertType raterType")
      .populate('expertId')   // Populates expertId based on expertType
      .populate('raterId');    // Populates raterId (which will always be a User)

    const formattedFeedback = feedback.map((feedback) => {
      const expert = feedback.expertId;
      const rater = feedback.raterId;

      return {
        _id: feedback._id,  // Include the review ID
        expertName: expert ? `${expert.firstName} ${expert.lastName}` : "Unknown Expert",
        raterName: rater ? `${rater.firstName} ${rater.lastName}` : "Unknown User",
        Rating: feedback.rating,  // Keep consistent with frontend expected structure
        comment: feedback.comment
      };
    });

    res.status(200).json({
      success: true,
      feedback: formattedFeedback,
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reviews",
      error: error.message,
    });
  }
});

// NEW FUNCTION: Get Withdrawal Requests (Pending only)
const getWithdrawalRequests = asyncHandler(async (req, res) => {
  try {
    const withdrawalRequests = await WithdrawalRequest.find({ status: 'pending' })
      .populate('userId', 'firstName lastName email walletBalance')
      .sort({ createdAt: -1 });

    const formattedRequests = withdrawalRequests.map((request) => {
      return {
        _id: request._id,
        transactionId: request._id.toString().slice(-6).toUpperCase(),
        expertName: request.userId ? `${request.userId.firstName} ${request.userId.lastName}` : "Unknown Expert",
        expertEmail: request.userId?.email || "N/A",
        amount: request.amount,
        method: request.method,
        status: request.status,
        walletBalance: request.userId?.walletBalance || 0,
        requestDate: request.createdAt.toLocaleDateString(),
        ipAddress: request.ipAddress,
        userAgent: request.userAgent
      };
    });

    res.status(200).json({
      success: true,
      requests: formattedRequests,
    });
  } catch (error) {
    console.error('Error fetching withdrawal requests:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawal requests",
      error: error.message
    });
  }
});

const getExpertWithdrawalRequests = asyncHandler(async (req, res) => {
  const requests = await ExpertWithdrawalRequest.find().populate('expertId', 'firstName lastName email');
  const formatted = requests.map((request) => ({
    _id: request._id,
    transactionId: request._id.toString().slice(-6).toUpperCase(),
    expertName: request.expertId ? `${request.expertId.firstName} ${request.expertId.lastName}` : "Unknown Expert",
    expertEmail: request.expertId?.email || "N/A",
    amount: request.amount,
    method: request.method,
    status: request.status,
    requestDate: request.createdAt.toLocaleDateString(),
    processedDate: request.updatedAt.toLocaleDateString(),
    rejectionReason: request.rejectionReason || null,
    ipAddress: request.ipAddress || null,
    walletBalance: request.walletBalance || null,
    bankDetails: request.bankDetails || null, // 🚀 Add this line**
  }));
  res.status(200).json({ success: true, requests: formatted });
});


const getExpertWithDrawalHistory = asyncHandler(async (req, res) => {
  try {
    const expertWithdrawalHistory = await ExpertWithdrawalRequest.find({ status: { $ne: 'pending' } })
      .populate('expertId', 'firstName lastName email')
      .sort({ updatedAt: -1 });
    const formattedHistory = expertWithdrawalHistory.map((request) => {
      return {
        _id: request._id,
        transactionId: request._id.toString().slice(-6).toUpperCase(),
        expertName: request.expertId ? `${request.expertId.firstName} ${request.expertId.lastName}` : "Unknown Expert",
        expertEmail: request.expertId?.email || "N/A",
        amount: request.amount,
        method: request.method,
        status: request.status,
        requestDate: request.createdAt.toLocaleDateString(),
        processedDate: request.updatedAt.toLocaleDateString(),
        rejectionReason: request.rejectionReason || null
      };
    });
    res.status(200).json({
      success: true,
      history: formattedHistory,
    });
  } catch (error) {
    console.error('Error fetching withdrawal history:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawal history",
      error: error.message
    });
  }
});




// NEW FUNCTION: Get Withdrawal History (All except pending, User + Expert)
const getWithdrawalHistory = asyncHandler(async (req, res) => {
  try {
    // Fetch user withdrawals
    const userWithdrawals = await WithdrawalRequest.find({
      status: { $ne: 'pending' }
    })
      .populate('userId', 'firstName lastName email')
      .sort({ updatedAt: -1 });

    const formattedUserHistory = userWithdrawals.map((request) => ({
      _id: request._id,
      transactionId: request._id.toString().slice(-6).toUpperCase(),
      expertName: request.userId ? `${request.userId.firstName} ${request.userId.lastName}` : "Unknown User",
      expertEmail: request.userId?.email || "N/A",
      amount: request.amount,
      method: request.method,
      status: request.status,
      requestDate: request.createdAt.toLocaleDateString(),
      processedDate: request.updatedAt.toLocaleDateString(),
      rejectionReason: request.rejectionReason || null,
      type: 'user',
      bankDetails: request.method === 'bank' ? {
        accountHolderName: request.bankDetails?.accountHolderName || "",
        accountNumber: request.bankDetails?.accountNumber || "",
        routingNumber: request.bankDetails?.routingNumber || "",
        bankName: request.bankDetails?.bankName || ""
      } : null
    }));

    // Fetch expert withdrawals
    const expertWithdrawals = await ExpertWithdrawalRequest.find({
      status: { $ne: 'pending' }
    })
      .populate('expertId', 'firstName lastName email')
      .sort({ updatedAt: -1 });

    const formattedExpertHistory = expertWithdrawals.map((request) => ({
      _id: request._id,
      transactionId: request._id.toString().slice(-6).toUpperCase(),
      expertName: request.expertId ? `${request.expertId.firstName} ${request.expertId.lastName}` : "Unknown Expert",
      expertEmail: request.expertId?.email || "N/A",
      amount: request.amount,
      method: request.method,
      status: request.status,
      requestDate: request.createdAt.toLocaleDateString(),
      processedDate: request.updatedAt.toLocaleDateString(),
      rejectionReason: request.rejectionReason || null,
      type: 'expert',
      bankDetails: request.method === 'bank' ? {
        accountHolderName: request.bankDetails?.accountHolderName || "",
        accountNumber: request.bankDetails?.accountNumber || "",
        routingNumber: request.bankDetails?.routingNumber || "",
        bankName: request.bankDetails?.bankName || ""
      } : null
    }));

    // Combine user + expert histories
    const combinedHistory = [...formattedUserHistory, ...formattedExpertHistory]
      .sort((a, b) => new Date(b.processedDate) - new Date(a.processedDate)); // Most recent first

    res.status(200).json({
      success: true,
      history: combinedHistory,
    });

  } catch (error) {
    console.error('Error fetching combined withdrawal history:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch combined withdrawal history",
      error: error.message
    });
  }
});



// Process Withdrawal Request (Accept/Reject)
const processWithdrawalRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, rejectionReason } = req.body;

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid action. Must be "accept" or "reject"',
    });
  }

  if (action === 'reject' && !rejectionReason) {
    return res.status(400).json({
      success: false,
      message: 'Rejection reason is required when rejecting a request',
    });
  }

  try {
    const withdrawalRequest = await WithdrawalRequest.findById(id).populate('userId');

    if (!withdrawalRequest) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found',
      });
    }

    if (withdrawalRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This request has already been processed',
      });
    }

    const user = withdrawalRequest.userId;
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (action === 'accept') {
      if (user.walletBalance < withdrawalRequest.amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient wallet balance for this withdrawal',
        });
      }

      // Step 1: Find the most recent completed TAP DEPOSIT transaction for the user
      const transaction = await Transaction.findOne({
        userId: user._id,
        type: 'DEPOSIT',
        paymentMethod: 'TAP',
        status: 'COMPLETED',
        'metadata.tapChargeId': { $exists: true },
      }).sort({ createdAt: -1 });

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: 'No TAP deposit transaction found to refund',
        });
      }
      
     

      // Step 2: Prepare refund payload
      const refundPayload = {
        charge_id: transaction.metadata.tapChargeId,
        amount: withdrawalRequest.amount,
        currency: transaction.currency || 'SAR',
        reason: 'User withdrawal refund to original payment method',
  
        metadata: {
          userId: user._id.toString(),
          withdrawalRequestId: withdrawalRequest._id.toString(),
        },
        reference: {
          merchant: `withdraw-${withdrawalRequest._id.toString().slice(-6).toUpperCase()}`,
        },
      };

      // Step 3: Send refund request to TAP
      const tapResponse = await axios.post('https://api.tap.company/v2/refunds/', refundPayload, {
        headers: {
           Authorization: `Bearer ${process.env.TAP_SECRET_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      // Step 4: Update wallet and mark withdrawal as approved
      user.walletBalance -= withdrawalRequest.amount;
      await user.save();

      withdrawalRequest.status = 'approved';
      withdrawalRequest.processedAt = new Date();
      await withdrawalRequest.save();

      
      // Send email notification
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
          },
        });

        const mailOptions = {
          from: process.env.MAIL_USER,
          to: user.email,
          subject: 'Withdrawal Request Processed',
          text: `Your refund of ${withdrawalRequest.amount} SAR has been successfully processed. The amount will be reflected in your original payment method within 7 business days.`,
        };

        await transporter.sendMail(mailOptions);
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
      }

      res.status(200).json({
        success: true,
        message: 'Withdrawal request approved and refund processed via TAP',
        data: {
          transactionId: withdrawalRequest._id.toString().slice(-6).toUpperCase(),
          amount: withdrawalRequest.amount,
          userName: `${user.firstName} ${user.lastName}`,
          newWalletBalance: user.walletBalance,
          tapRefundId: tapResponse.data.id,
        },
      });

    } else if (action === 'reject') {
      withdrawalRequest.status = 'rejected';
      withdrawalRequest.rejectionReason = rejectionReason;
      withdrawalRequest.processedAt = new Date();
      await withdrawalRequest.save();

      res.status(200).json({
        success: true,
        message: 'Withdrawal request rejected successfully',
        data: {
          transactionId: withdrawalRequest._id.toString().slice(-6).toUpperCase(),
          rejectionReason: rejectionReason,
        },
      });
    }

  } catch (error) {
    console.error('Error processing withdrawal request:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal request',
      error: error.response?.data || error.message,
    });
  }
});
// Process Expert Withdrawal Request (Accept/Reject)
const processExpertWithdrawalRequest = asyncHandler(async (req, res) => {
  const { action, rejectionReason } = req.body;
  const { requestId } = req.params;

  const request = await ExpertWithdrawalRequest.findById(requestId);
  if (!request) {
    return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
  }

  const expert = await Expert.findById(request.expertId);
  if (!expert) {
    return res.status(404).json({ success: false, message: 'Expert not found' });
  }

  if (action === "accept") {
    if (request.status !== "pending") {
      return res.status(400).json({ success: false, message: 'Withdrawal request is not pending' });
    }

    // Check sufficient balance
    if (expert.wallets.earning.balance < request.amount) {
      return res.status(400).json({ success: false, message: 'Insufficient expert wallet balance' });
    }

    // Deduct from expert's wallet
    expert.wallets.earning.balance  -= request.amount;
    await expert.save();

    // Update withdrawal request
    request.status = "approved";
    request.processedAt = new Date();
    await request.save();

    return res.status(200).json({
      success: true,
      message: "Withdrawal request accepted successfully"
    });
  }

  if (action === "reject") {
    if (!rejectionReason || rejectionReason.trim() === "") {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ success: false, message: 'Withdrawal request is not pending' });
    }

    // Update withdrawal request
    request.status = "rejected";
    request.rejectionReason = rejectionReason;
    request.processedAt = new Date();
    await request.save();

    return res.status(200).json({
      success: true,
      message: "Withdrawal request rejected successfully"
    });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
});


const getAllTransaction = asyncHandler(async (req, res) => {
  try {
    const transaction = await Transaction.find()
      .populate('expertId', 'firstName lastName')
      .populate('userId', 'firstName lastName');

    res.status(200).json({
      message: "Transactions fetched successfully",
      transaction
    });
  } catch (err) {
    res.status(400).json({ message: "Error fetching transactions" });
  }
});



export { 
  loginAdmin,
  updateExpertStatus,
  getBookingDetails, 
  getreview, 
  forgotPassword,
  getWithdrawalRequests,
  getWithdrawalHistory,
  processWithdrawalRequest,
  getExpertWithdrawalRequests,
  getExpertWithDrawalHistory,
  processExpertWithdrawalRequest,
  getAllTransaction 
}