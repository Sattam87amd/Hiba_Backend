import { UserToExpertSession } from '../model/usertoexpertsession.model.js';
import { Expert } from '../model/expert.model.js'; // Import Expert model
import { ExpertToExpertSession } from '../model/experttoexpertsession.model.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import asyncHandler from '../utils/asyncHandler.js';
import axios from 'axios'; // Import axios for TAP API calls
import { createZoomMeeting } from '../utils/createZoomMeeting.js'; // Import Zoom meeting creation
import { User } from "../model/user.model.js"; // For wallet operations
import { applyGiftCardToBooking } from "./giftcard.controller.js"; // Import gift card function
import ApiError from '../utils/ApiError.js'; // Import ApiError
import { sendEmail } from "../utils/emailService.js"; // Import sendEmail utility
import { generateUserVideoSDKSignature } from '../utils/userVideoSDKHelper.js';
import Transaction from '../model/transaction.model.js'; // Import Transaction model
import Rating from '../model/rating.model.js';

dotenv.config();

// User-side controller to check if the session time is available

// Controller for getting sessions where the expert is providing service
const getExpertSessions = asyncHandler(async (req, res) => {
  const { expertId } = req.params;
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(400).json({ message: "Token is required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    
    // Verify that the requesting user is the expert or has permission
    if (decoded._id !== expertId && decoded.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized to access these sessions" });
    }

    // Find sessions where this expert is providing the service
    const sessions = await UserToExpertSession.find({
      expertId: expertId,
    })
      .populate("userId", "firstName lastName email")
      .populate("expertId", "firstName lastName email")
      .select('+zoomMeetingLink +zoomMeetingId +zoomPassword +zoomSessionName') // Explicitly select these fields
      .sort({ createdAt: -1 }); // Most recent first

    if (!sessions.length) {
      return res.status(404).json({ message: "No sessions found for this expert." });
    }

    res.status(200).json({
      success: true,
      sessions: sessions
    });
  } catch (error) {
    console.error("Error fetching expert sessions:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching expert sessions.",
      error: error.message,
    });
  }
});

// Alternative method to get current/active session for an expert
const getCurrentExpertSession = asyncHandler(async (req, res) => {
  const { expertId } = req.params;
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(400).json({ message: "Token is required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    
    // Verify authorization
    if (decoded._id !== expertId && decoded.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Find the most recent active session for this expert
    const session = await UserToExpertSession.findOne({
      expertId: expertId,
      status: { $in: ['confirmed', 'pending', 'unconfirmed'] }
    })
      .populate("userId", "firstName lastName email")
      .populate("expertId", "firstName lastName email")
      .sort({ createdAt: -1 });

    if (!session) {
      return res.status(404).json({ 
        success: false,
        message: "No active session found for this expert." 
      });
    }

    res.status(200).json({
      success: true,
      session: session
    });
  } catch (error) {
    console.error("Error fetching current expert session:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching current session.",
      error: error.message,
    });
  }
});

const checkAvailability = async (expertId, sessionDate, sessionTime) => {
  try {
    // Check if there's a user-to-expert session already booked
    const existingUserSession = await UserToExpertSession.findOne({
      expertId,
      sessionDate,
      sessionTime
    });
    
    // If user-to-expert session exists, time is not available
    if (existingUserSession) {
      return false;
    }
    
    // Also check if there's an expert-to-expert session booked
    const existingExpertSession = await ExpertToExpertSession.findOne({
      consultingExpertID: expertId,  // Assuming this is the field name in your schema
      sessionDate,
      sessionTime
    });
    
    // Time is available only if neither type of session exists
    return !existingExpertSession;
    
  } catch (error) {
    throw new Error("Error checking availability: " + error.message);
  }
};

// Function to check if a user is eligible for a free session
const checkFreeSessionEligibility = async (userId, expertId) => {
  try {
    // Check if the expert has enabled free sessions
    const expert = await Expert.findById(expertId);
    
    if (!expert || !expert.freeSessionEnabled) {
      return false;
    }

    // Check if the user has had any previous user-to-expert sessions with this expert
    const existingUserToExpertSessions = await UserToExpertSession.findOne({
      userId: userId,
      expertId: expertId
    });

    // Check if the user has had any previous expert-to-expert sessions with this expert
    const existingExpertToExpertSessions = await ExpertToExpertSession.findOne({
      expertId: userId, // The user is an expert in this case
      consultingExpertID: expertId
    });

    // User is eligible if they have had no previous sessions with this expert
    return !existingUserToExpertSessions && !existingExpertToExpertSessions;
  } catch (error) {
    console.error("Error checking free session eligibility:", error);
    return false;
  }
};

// Function to create a TAP payment
const createTapPayment = async (sessionData, price, successRedirectUrl, cancelRedirectUrl) => {
  try {
    const payload = {
      amount: price,
      currency: "SAR", // Change to your currency
      customer: {
        first_name: sessionData.firstName,
        last_name: sessionData.lastName,
        email: sessionData.email,
        phone: {
          country_code: "+971", // Default to UAE, adjust as needed
          number: sessionData.phone
        }
      },
      source: { id: "src_all" },
      redirect: {
        url: successRedirectUrl
      },
      post: {
        url: cancelRedirectUrl
      },
      metadata: {
        sessionId: sessionData._id.toString(),
        sessionType: "user-to-expert"
      }
    };

    const response = await axios.post(
      "https://api.tap.company/v2/charges",
      payload,
      {
        headers: {
          "Authorization": `Bearer ${process.env.TAP_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error("Error creating TAP payment:", error.response?.data || error);
    throw new Error("Payment gateway error: " + (error.response?.data?.message || error.message));
  }
};

// Controller for "My Bookings" - When the logged-in user is the one who booked the session (userId)
const getUserBookings = asyncHandler(async (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(400).json({ message: "Token is required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;

    // Find sessions where the logged-in user is the one who booked the session (userId)
    const sessions = await UserToExpertSession.find({
      userId: userId,
    })
      .populate("userId", "firstName lastName")
      .populate("expertId", "firstName lastName")
      // .sort({ sessionDate: 1 });

    if (!sessions.length) {
      return res.status(404).json({ message: "No bookings found for this user." });
    }

    res.status(200).json(sessions);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res.status(500).json({
      message: "An error occurred while fetching user bookings.",
      error: error.message,
    });
  }
});

// Controller for booking a session for user-to-expert
const bookUserToExpertSession = asyncHandler(async (req, res) => {
  const {
    expertId,
    areaOfExpertise,
    // sessionType is implicitly 'user-to-expert'
    slots,
    firstName, // Booker's (User's) details
    lastName,
    duration,
    note,
    phone,
    email,
    price, // Price from frontend
    redemptionCode, // Optional: Gift card redemption code
  } = req.body;

  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    throw new ApiError(400, "Token is required");
  }

  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  const userId = decoded._id; // This is the user making the booking and payment

  // Check if the user is eligible for a free session with this expert
  const isEligibleForFreeSession = await checkFreeSessionEligibility(userId, expertId);
  
  const initialPrice = isEligibleForFreeSession ? 0 : (parseFloat(price) || 0);
  if (isNaN(initialPrice) || initialPrice < 0) {
    throw new ApiError(400, "Invalid price. Must be a non-negative number.");
  }

  let finalPriceToPay = initialPrice;
  let giftCardDetails = null;
  let paymentMethodForSession = initialPrice === 0 ? 'free' : 'wallet';

  // 1. Apply Gift Card if provided and session has a price
  if (initialPrice > 0 && redemptionCode) {
    try {
      const giftCardResult = await applyGiftCardToBooking(redemptionCode, initialPrice);
      finalPriceToPay = initialPrice - giftCardResult.redeemedAmount;
      if (finalPriceToPay < 0) finalPriceToPay = 0;

      giftCardDetails = {
        giftCardId: giftCardResult.giftCardId,
        amountRedeemed: giftCardResult.redeemedAmount,
        codeUsed: redemptionCode,
      };
      paymentMethodForSession = finalPriceToPay <= 0 ? 'gift_card' : 'gift_card_plus_wallet';
      console.log(`Gift card ${redemptionCode} applied. Original: ${initialPrice}, Redeemed: ${giftCardResult.redeemedAmount}. Due: ${finalPriceToPay}`);
    } catch (gcError) {
      console.error("Gift card redemption error:", gcError.message);
      throw new ApiError(400, `Gift card error: ${gcError.message}`);
    }
  }

  // Prepare base session data
  const sessionData = {
    userId,
    expertId,
    areaOfExpertise,
    slots,
    status: "unconfirmed",
    sessionType: "user-to-expert",
    duration,
    note,
    firstName,
    lastName,
    phone,
    email,
    price: initialPrice, // Original price of the session (after free session check)
    paymentMethod: paymentMethodForSession,
    giftCardRedeemedId: giftCardDetails ? giftCardDetails.giftCardId : null,
    giftCardAmountRedeemed: giftCardDetails ? giftCardDetails.amountRedeemed : 0,
    // paymentAmount and paymentStatus will be set below
  };
  
  // 2. Handle Payment
  if (initialPrice === 0) { // Truly free session (eligible or gift card made $0 session $0)
    sessionData.paymentStatus = 'not_applicable';
    sessionData.paymentAmount = 0;
    sessionData.paymentMethod = 'free'; // Override if gift card was pointlessly applied
  } else { // Priced session
    if (finalPriceToPay <= 0) { // Fully covered by gift card
      sessionData.paymentStatus = 'completed';
      sessionData.paymentAmount = 0;
      // paymentMethodForSession is already 'gift_card'
    } else { // Needs wallet payment for the remaining amount
      const booker = await User.findById(userId);
      if (!booker) {
        throw new ApiError(404, "Booking user not found.");
      }
      if ((booker.walletBalance || 0) < finalPriceToPay) {
        throw new ApiError(400, `Insufficient wallet balance. Please top up your wallet. Amount due: ${finalPriceToPay} SAR`);
      }
      booker.walletBalance -= finalPriceToPay;
      await booker.save();
      
      sessionData.paymentStatus = 'completed';
      sessionData.paymentAmount = finalPriceToPay; // Amount paid from wallet
      // paymentMethodForSession is 'wallet' or 'gift_card_plus_wallet'
      console.log(`Paid ${finalPriceToPay} from wallet by user ${userId}. New balance: ${booker.walletBalance}`);
    }
  }

  // Calculate potential payout but defer until expert confirms
  const expertDoc = await Expert.findById(expertId);
  if (expertDoc) {
    const avgRating = expertDoc.averageRating || 0;
    const sharePercentage = avgRating >= 4 ? 0.7 : 0.5;
    const expertShare = finalPriceToPay * sharePercentage;
    const platformFee = finalPriceToPay - expertShare;

    sessionData.expertPayoutAmount = expertShare;
    sessionData.platformFeeAmount = platformFee;
    sessionData.payoutProcessed = false;
  }

  const newSession = new UserToExpertSession(sessionData);
  await newSession.save();

  const expert = await Expert.findById(newSession.expertId).select('email firstName lastName');

  // Send email notifications for booking confirmation
  try {
    // Email to the user who booked the session
    await sendEmail({
      to: newSession.email, // Booker's (User's) email
      subject: "Session Booking Confirmation - User to Expert",
      html: `<h1>Booking Confirmed!</h1>
             <p>Hello ${newSession.firstName},</p>
             <p>Your session with expert ${expert.firstName} ${expert.lastName} has been successfully booked and is awaiting confirmation from the expert.</p>
             <p>Session ID: ${newSession._id}</p>
             <p>Status: ${newSession.status}</p>
             <p>Amount Paid: ${newSession.paymentAmount} SAR (via ${newSession.paymentMethod})</p>
             ${newSession.giftCardAmountRedeemed > 0 ? `<p>Gift Card Redeemed: ${newSession.giftCardAmountRedeemed} SAR</p>` : ''}
             <p>Thank you for using our platform.</p>`
    });

    // Email to the expert being booked
   
    if (expert && expert.email) {
      await sendEmail({
        to: expert.email,
        subject: "New User Session Request",
        html: `<h1>New Session Request!</h1>
               <p>Hello ${expert.firstName || 'Expert'},</p>
               <p>You have a new session request from user ${newSession.firstName} ${newSession.lastName}.</p>
               <p>Please log in to your dashboard to accept or decline this session.</p>
               <p>Session ID: ${newSession._id}</p>`
      });
    }
  } catch (emailError) {
    console.error("Failed to send booking confirmation emails for U2E session:", newSession._id, emailError);
    // Do not fail the booking if email sending fails, just log it.
  }

  // Update expert's ratings and average
  if (expert) {
    expert.ratings = expert.ratings || [];
    expert.ratings.push(newSession._id);
    const allRatings = await Rating.find({ expertId: expert._id });
    const totalRatings = allRatings.length;
    const avgRating = totalRatings > 0 ? allRatings.reduce((sum, r) => sum + (r.rating || 0), 0) / totalRatings : 0;
    expert.averageRating = avgRating;
    expert.numberOfRatings = totalRatings;
    await expert.save();
  }

  return res.status(201).json({
    message: `Session booked successfully. Status: ${newSession.status}, Payment Status: ${newSession.paymentStatus}.`,
    session: newSession,
    isFreeSession: initialPrice === 0 && !redemptionCode, // True if eligible for free session and no gift card was used
  });
});

// Get user booked slots from both UserToExpertSession and ExpertToExpertSession collections
const getUserBookedSlots = asyncHandler(async (req, res) => {
  const { expertId } = req.params;

  try {
    // Find booked slots in UserToExpertSession
    const userToExpertSessions = await UserToExpertSession.find({
      expertId: expertId,
      status: { $in: ['pending', 'confirmed', 'unconfirmed', 'completed','Rating Submitted'] }
    });
    
    // Find booked slots in ExpertToExpertSession where this expert is the consulting expert
    const expertToExpertSessions = await ExpertToExpertSession.find({
      consultingExpertID: expertId,  // Assuming this is the field name in your schema
      status: { $in: ['pending', 'confirmed', 'unconfirmed','completed','Rating Submitted'] }
    });
    
    // Extract slots from user-to-expert sessions
    const userToExpertSlots = userToExpertSessions.flatMap(session => session.slots);
    
    // Extract slots from expert-to-expert sessions
    const expertToExpertSlots = expertToExpertSessions.flatMap(session => session.slots);
    
    // Combine slots from both collections
    const allBookedSlots = [...userToExpertSlots, ...expertToExpertSlots];

    res.status(200).json({
      success: true,
      data: allBookedSlots
    });
  } catch (error) {
    console.error("Error fetching booked slots:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching booked slots",
      error: error.message
    });
  }
});

// Payment success handler - API endpoint for success redirect
const handlePaymentSuccess = asyncHandler(async (req, res) => {
  const { sessionId, tap_id } = req.query;

  try {
    // Verify payment status with TAP API
    const paymentVerification = await axios.get(
      `https://api.tap.company/v2/charges/${tap_id}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.TAP_SECRET_KEY}`
        }
      }
    );

    const paymentStatus = paymentVerification.data.status;
    const paymentAmount = paymentVerification.data.amount;
    
    // Find and update the session
    const session = await UserToExpertSession.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (paymentStatus === "CAPTURED") {
      // Update session with payment details
      session.status = "unconfirmed"; // Change status to unconfirmed when payment is successful
      session.paymentStatus = "completed";
      session.paymentId = tap_id;
      session.paymentAmount = paymentAmount;
      
      await session.save();
      
      // Return success with redirect URL
      return res.status(200).json({
        success: true,
        message: "Payment successful. Session status updated to unconfirmed.",
        redirectUrl: `/userpanel/videocall?sessionId=${sessionId}`
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment not completed",
        paymentStatus
      });
    }
  } catch (error) {
    console.error("Payment success handler error:", error);
    res.status(500).json({ 
      success: false,
      message: "Error processing payment success", 
      error: error.message 
    });
  }
});

// Helper function to get the duration in minutes from the string format
const getDurationInMinutes = (durationStr) => {
  if (typeof durationStr === "number") return durationStr;
  const match = durationStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 15;
};

/// Generate Video SDK auth for USER
const generateUserVideoSDKAuth = asyncHandler(async (req, res) => {
  const { meetingNumber } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    console.log('=== USER VIDEO SDK AUTH ===');
    console.log('Meeting Number:', meetingNumber);
    console.log('Token exists:', !!token);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authorization token required"
      });
    }
    
    if (!meetingNumber) {
      return res.status(400).json({
        success: false,
        message: "Meeting number is required"
      });
    }
    
    // Verify user token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    console.log('User decoded:', { id: decoded._id, role: decoded.role });
    
    if (decoded.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: "This endpoint is for users only"
      });
    }
    
    // Generate signature for user (role = 0, attendee)
    const authData = generateUserVideoSDKSignature(meetingNumber, 0);
    
    console.log('✅ User video SDK auth generated successfully');
    
    res.status(200).json({
      success: true,
      message: "User video SDK authentication generated",
      role: 'attendee',
      userType: 'user',
      ...authData
    });
    
  } catch (error) {
    console.error("❌ Error generating user video SDK auth:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate user video SDK authentication",
      error: error.message
    });
  }
});

// Get user session details for video call
const getUserSessionDetails = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  try {
    console.log('=== GET USER SESSION DETAILS ===');
    console.log('Session ID:', sessionId);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authorization token required"
      });
    }
    
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;
    
    console.log('User ID:', userId);
    
    // Find the session
    const session = await UserToExpertSession.findById(sessionId)
      .populate('userId', 'firstName lastName email')
      .populate('expertId', 'firstName lastName email');
    
    if (!session) {
      console.log('❌ Session not found');
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    console.log('Session found:', {
      sessionUserId: session.userId._id.toString(),
      currentUserId: userId
    });
    
    // Verify user is authorized for this session
    if (session.userId._id.toString() !== userId) {
      console.log('❌ User not authorized');
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this session'
      });
    }
    
    console.log('✅ User authorized for session');
    
    res.status(200).json({
      success: true,
      session: session,
      userRole: 'attendee',
      userType: 'user',
      meetingId: session.zoomMeetingId, // This should contain the meeting number
      meetingLink: session.zoomMeetingLink,
      duration: session.duration // Ensure duration is at the top level
    });
    
  } catch (error) {
    console.error('❌ Error fetching user session details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session details',
      error: error.message
    });
  }
});

const markSessionPaid = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  // Optionally, verify authenticated user if required:
  // const userId = req.user?._id;
  // if (!userId) throw new ApiError(401, "Unauthorized");

  const session = await UserToExpertSession.findById(sessionId);

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.paymentStatus === "completed") {
    return res.status(200).json({
      success: true,
      message: "Session already marked as paid",
      session
    });
  }

  session.paymentStatus = "completed";
  session.paymentMethod = "Hyperpay"; // Mark that it was paid via HyperPay
  session.paymentReference = req.body.paymentReference || ""; // Optional for storing transaction ID

  await session.save();

  res.status(200).json({
    success: true,
    message: "Session marked as paid successfully",
    session
  });
});

// Complete user session
const completeUserSession = asyncHandler(async (req, res) => {
  const { sessionId, endTime, status = 'completed', actualDuration } = req.body;
  const token = req.header("Authorization")?.replace("Bearer ", "");

  try {
    console.log('=== COMPLETE USER SESSION ===');
    console.log('Session ID:', sessionId);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authorization token required"
      });
    }
    
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded._id;

    const session = await UserToExpertSession.findById(sessionId);

    if (!session) {
      return res.status(404).json({ 
        success: false,
        message: 'Session not found' 
      });
    }
    
    // Verify user authorization
    if (session.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to complete this session'
      });
    }

    const updateData = {
      status: status,
      endTime: new Date(endTime),
      completedAt: new Date(),
      actualDuration: actualDuration || session.duration
    };

    const updatedSession = await UserToExpertSession.findByIdAndUpdate(
      sessionId, 
      updateData, 
      { new: true }
    );

    console.log('✅ User session completed successfully');

    res.status(200).json({
      success: true,
      message: 'Session completed successfully',
      session: updatedSession
    });

  } catch (error) {
    console.error('❌ Error completing user session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete session',
      error: error.message
    });
  }
});

// Add this new function after the existing functions
const sendSessionStatusEmail = async (session, status) => {
  try {
    const expert = await Expert.findById(session.expertId).select('firstName lastName');
    const subject = status === 'confirmed' ? 'Session Confirmed' : 'Session Rejected';
    const message = status === 'confirmed' 
      ? `Your session with expert ${expert.firstName} ${expert.lastName} has been confirmed.`
      : `Your session with expert ${expert.firstName} ${expert.lastName} has been rejected.`;
    
    await sendEmail({
      to: session.email,
      subject: subject,
      html: `<h1>${subject}</h1>
             <p>Hello ${session.firstName},</p>
             <p>${message}</p>
             <p>Session ID: ${session._id}</p>
             <p>Thank you for using our platform.</p>`
    });
  } catch (error) {
    console.error(`Failed to send ${status} email notification:`, error);
  }
};

// Update the updateSessionStatus function to include email notification
const updateSessionStatus = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { status } = req.body;
  
  const session = await UserToExpertSession.findById(sessionId);
  if (!session) {
    throw new ApiError(404, "Session not found");
  }
  
  session.status = status;
  // If expert confirms and payout not processed, credit earning wallet
  if (status === 'confirmed' && !session.payoutProcessed) {
    const expertDoc = await Expert.findById(session.expertId);
    if (expertDoc) {
      expertDoc.wallets = expertDoc.wallets || { earning: { balance: 0, ledger: [] }, spending: { balance: 0, ledger: [] } };
      expertDoc.wallets.earning.balance += session.expertPayoutAmount;

      const creditTx = await Transaction.create({
        expertId: expertDoc._id,
        type: 'DEPOSIT',
        amount: session.expertPayoutAmount,
        status: 'COMPLETED',
        paymentMethod: 'WALLET',
        description: 'User session earnings (confirmed)',
        metadata: { origin: 'user_to_expert_session', sessionId: session._id }
      });
      expertDoc.wallets.earning.ledger = expertDoc.wallets.earning.ledger || [];
      expertDoc.wallets.earning.ledger.push(creditTx._id);
      expertDoc.transactions = expertDoc.transactions || [];
      expertDoc.transactions.push(creditTx._id);
      await expertDoc.save();
      session.payoutProcessed = true;
    }
  }
  await session.save();
  
  // Send email notification for confirmed or rejected status
  if (status === 'confirmed' || status === 'rejected') {
    await sendSessionStatusEmail(session, status);
  }
  
  res.status(200).json({
    success: true,
    message: `Session status updated to ${status}`,
    session
  });
});

export { 
  bookUserToExpertSession,
  getUserBookings,
  getUserBookedSlots,
  handlePaymentSuccess,
  completeUserSession,
  getUserSessionDetails,
  generateUserVideoSDKAuth,
  getExpertSessions,        // Add this
  getCurrentExpertSession,
  updateSessionStatus,
  markSessionPaid
};