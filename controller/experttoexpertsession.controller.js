import { ExpertToExpertSession } from "../model/experttoexpertsession.model.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { createZoomMeeting } from "../utils/createZoomMeeting.js";
import { UserToExpertSession } from "../model/usertoexpertsession.model.js";
import axios from "axios"; // Make sure to import axios
import { generateVideoSDKSignature } from "../utils/videoSDKHelper.js"; // Assuming you have a utility to generate meeting numbers
import { User } from "../model/user.model.js";
import Rating from "../model/rating.model.js"; // Import Rating model
import { Expert } from "../model/expert.model.js"; // Added Expert model import
import { applyGiftCardToBooking } from "./giftcard.controller.js"; // Import gift card function
import { sendEmail } from "../utils/emailService.js"; // Import sendEmail utility
import Transaction from "../model/transaction.model.js"; // Import Transaction model
dotenv.config();

// Helper function to check if the consulting expert's session time is available
const checkAvailability = async (
  consultingExpertId,
  sessionDate,
  sessionTime
) => {
  try {
    // Find if there is any session already booked for the consulting expert at the same sessionTime and sessionDate
    const existingExpertSession = await ExpertToExpertSession.findOne({
      consultingExpertID: consultingExpertId,
      sessionDate,
      sessionTime,
    });

    // If expert-to-expert session exists, time is not available
    if (existingExpertSession) {
      return false;
    }

    // Now check if there's a user-to-expert session booked
    const existingUserSession = await UserToExpertSession.findOne({
      expertId: consultingExpertId,
      sessionDate,
      sessionTime,
    });

    // If no session is found in either collection, the time is available
    return !existingUserSession;
  } catch (error) {
    throw new ApiError("Error checking availability", 500);
  }
};

// Function to create a TAP payment (This will be used for WALLET TOP-UP, not direct session payment)
const createTapPayment = async (
  sessionData,
  price,
  successRedirectUrl,
  cancelRedirectUrl
) => {
  try {
    // Convert price to halalas (smallest currency unit for SAR)
    const amountInHalalas = Math.round(parseFloat(price) * 100);

    if (isNaN(amountInHalalas) || amountInHalalas <= 0) {
      throw new Error("Invalid price amount. Price must be a positive number.");
    }

    const payload = {
      amount: amountInHalalas, // Use the converted amount
      currency: "SAR", // Change to your currency
      customer: {
        first_name: sessionData.firstName,
        last_name: sessionData.lastName,
        email: sessionData.email,
        phone: {
          country_code: "+971", // Default to UAE, adjust as needed
          number: sessionData.mobile,
        },
      },
      source: { id: "src_all" },
      redirect: {
        url: successRedirectUrl,
      },
      post: {
        url: cancelRedirectUrl,
      },
      metadata: {
        sessionId: sessionData._id.toString(),
        sessionType: "expert-to-expert",
      },
    };

    const response = await axios.post(
      "https://api.tap.company/v2/charges",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.TAP_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("Error creating TAP payment:", error.response?.data || error);
    throw new Error(
      "Payment gateway error: " +
        (error.response?.data?.message || error.message)
    );
  }
};

// Get expert booked slots from both ExpertToExpertSession and UserToExpertSession collections
const getExpertBookedSlots = asyncHandler(async (req, res) => {
  const { expertId } = req.params;

  try {
    // Find booked slots in ExpertToExpertSession
    const expertToExpertSessions = await ExpertToExpertSession.find({
      consultingExpertID: expertId,
      status: {
        $in: [
          "pending",
          "confirmed",
          "unconfirmed",
          "completed",
          "Rating Submitted",
        ],
      },
    });

    // Find booked slots in UserToExpertSession
    const userToExpertSessions = await UserToExpertSession.find({
      expertId: expertId,
      status: {
        $in: [
          "pending",
          "confirmed",
          "unconfirmed",
          "completed",
          "Rating Submitted",
        ],
      },
    });

    // Extract slots from expert-to-expert sessions
    const expertToExpertSlots = expertToExpertSessions.flatMap(
      (session) => session.slots
    );

    // Extract slots from user-to-expert sessions
    const userToExpertSlots = userToExpertSessions.flatMap(
      (session) => session.slots
    );

    // Combine slots from both collections
    const allBookedSlots = [...expertToExpertSlots, ...userToExpertSlots];

    res.status(200).json({
      success: true,
      data: allBookedSlots,
    });
  } catch (error) {
    console.error("Error fetching booked slots:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching booked slots",
      error: error.message,
    });
  }
});

// Controller for "My Bookings" - When the logged-in expert is the one who booked the session
const getMyBookings = asyncHandler(async (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(400).json({ message: "Token is required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const expertId = decoded._id;

    // Find sessions where the logged-in expert is the one who booked the session
    const sessions = await ExpertToExpertSession.find({
      expertId: expertId,
    })
      .populate("expertId", "firstName lastName")
      .populate("consultingExpertID", "firstName lastName")
      .sort({ sessionDate: 1 });

    if (!sessions.length) {
      return res
        .status(404)
        .json({ message: "No bookings found for this expert." });
    }

    res.status(200).json(sessions);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({
      message: "An error occurred while fetching bookings.",
      error: error.message,
    });
  }
});

const getMySessions = asyncHandler(async (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(400).json({ message: "Token is required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const expertId = decoded._id;

    // Find sessions where the logged-in expert is the consulting expert
    const expertSessions = await ExpertToExpertSession.find({
      consultingExpertID: expertId,
    })
      .populate("expertId", "firstName lastName email")
      .populate("consultingExpertID", "firstName lastName email")
      .select('+zoomMeetingLink +zoomMeetingId +zoomPassword +zoomSessionName') // Explicitly select these fields
      .sort({ expertSessionDate: 1 });

    // Find sessions where the logged-in expert is the consulting expert
    const userSessions = await UserToExpertSession.find({
      expertId: expertId,
    })
      .populate("userId", "firstName lastName email")
      .populate("expertId", "firstName lastName email")
      .select('+zoomMeetingLink +zoomMeetingId +zoomPassword +zoomSessionName') // Explicitly select these fields
      .sort({ createdAt: -1 });

    // Check if both expertSessions and userSessions are empty
    if (expertSessions.length === 0 && userSessions.length === 0) {
      return res
        .status(404)
        .json({ message: "No sessions found for this expert." });
    }

    // Format expertSessions to always include consultingExpertID and expertId as strings
    const formattedExpertSessions = expertSessions.map(session => {
      const obj = session.toObject();
      obj.consultingExpertID = obj.consultingExpertID?._id?.toString() || obj.consultingExpertID?.toString() || obj.consultingExpertID;
      obj.expertId = obj.expertId?._id?.toString() || obj.expertId?.toString() || obj.expertId;
      return obj;
    });
    // Format userSessions similarly
    const formattedUserSessions = userSessions.map(session => {
      const obj = session.toObject();
      obj.expertId = obj.expertId?._id?.toString() || obj.expertId?.toString() || obj.expertId;
      if (obj.userId) obj.userId = obj.userId?._id?.toString() || obj.userId?.toString() || obj.userId;
      // Add consultingExpertID as null for user sessions (not applicable)
      obj.consultingExpertID = null;
      return obj;
    });

    // Respond with the sessions
    res.status(200).json({ 
      success: true,
      expertSessions: formattedExpertSessions, 
      userSessions: formattedUserSessions
    });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching sessions.",
      error: error.message,
    });
  }
});

// Expert-to-Expert session booking controller
const bookExpertToExpertSession = asyncHandler(async (req, res) => {
  const {
    consultingExpertId,
    areaOfExpertise,
    slots,
    duration,
    note,
    // sessionType is implicitly 'expert-to-expert' here
    firstName, // Booker's details
    lastName,
    email,
    mobile,
    price, // Price from frontend
    redemptionCode, // Optional: Gift card redemption code
  } = req.body;

  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    throw new ApiError(400, "Token is required");
  }

  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  const bookingExpertId = decoded._id; // This is the expert making the booking and payment

  if (bookingExpertId === consultingExpertId) {
    throw new ApiError(400, "An expert cannot book a session with themselves.");
  }

  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0) {
    throw new ApiError(400, "Invalid price. Must be a non-negative number.");
  }

  let finalPriceToPay = parsedPrice;
  let giftCardDetails = null;
  let paymentMethodForSession = parsedPrice === 0 ? "free" : "wallet"; // Default if priced
  let paymentStatusForSession = "pending"; // Default, will change based on logic

  // 1. Apply Gift Card if provided and session has a price
  if (parsedPrice > 0 && redemptionCode) {
    try {
      const giftCardResult = await applyGiftCardToBooking(
        redemptionCode,
        parsedPrice
      );
      // giftCardResult = { success: true, redeemedAmount, remainingBalance, giftCardId, newStatus }

      finalPriceToPay = parsedPrice - giftCardResult.redeemedAmount;
      if (finalPriceToPay < 0) finalPriceToPay = 0; // Ensure it doesn't go negative

      giftCardDetails = {
        giftCardId: giftCardResult.giftCardId,
        amountRedeemed: giftCardResult.redeemedAmount,
        codeUsed: redemptionCode,
      };

      paymentMethodForSession =
        finalPriceToPay <= 0 ? "gift_card" : "gift_card_plus_wallet";
      console.log(
        `Gift card ${redemptionCode} applied. Original: ${parsedPrice}, Redeemed: ${giftCardResult.redeemedAmount}. Due: ${finalPriceToPay}`
      );
    } catch (gcError) {
      console.error("Gift card redemption error:", gcError.message);
      // If gift card is invalid/expired, stop the booking if it was meant to cover a paid session.
      // Frontend should ideally validate this first using the /check/:redemptionCode endpoint.
      throw new ApiError(400, `Gift card error: ${gcError.message}`);
    }
  }

  // Prepare base session data
  const sessionData = {
    expertId: bookingExpertId,
    consultingExpertID: consultingExpertId,
    areaOfExpertise,
    slots,
    status: "unconfirmed", // All sessions start as unconfirmed, pending expert acceptance
    sessionType: "expert-to-expert",
    duration,
    note,
    firstName, // Booker's details
    lastName,
    mobile,
    email,
    price: parsedPrice, // Original price of the session
    paymentMethod: paymentMethodForSession,
    giftCardRedeemedId: giftCardDetails ? giftCardDetails.giftCardId : null,
    giftCardAmountRedeemed: giftCardDetails
      ? giftCardDetails.amountRedeemed
      : 0,
    // paymentAmount and paymentStatus will be set below
  };

  // 2. Handle Payment
  if (parsedPrice === 0) {
    // Truly free session (or gift card made a $0 session $0)
    sessionData.paymentStatus = "not_applicable";
    sessionData.paymentAmount = 0;
    sessionData.paymentMethod = "free"; // Override if gift card was pointlessly applied
  } else {
    // Priced session
    if (finalPriceToPay <= 0) {
      // Fully covered by gift card
      sessionData.paymentStatus = "completed";
      sessionData.paymentAmount = 0;
      // paymentMethodForSession is already 'gift_card'
    } else {
      // Needs wallet payment for the remaining amount
      const booker = await Expert.findById(bookingExpertId); // Assuming Expert details are in User model for wallet
      if (!booker) {
        throw new ApiError(404, "Booking expert not found.");
      }
      if ((booker.walletBalance || 0) < finalPriceToPay) {
        throw new ApiError(
          400,
          `Insufficient wallet balance. Please top up your wallet. Amount due: ${finalPriceToPay} SAR`
        );
      }

      booker.walletBalance -= finalPriceToPay;
      await booker.save();

      sessionData.paymentStatus = "completed";
      sessionData.paymentAmount = finalPriceToPay; // Amount paid from wallet
      // paymentMethodForSession is 'wallet' or 'gift_card_plus_wallet'
      console.log(
        `Paid ${finalPriceToPay} from wallet by expert ${bookingExpertId}. New balance: ${booker.walletBalance}`
      );
    }
  }

  const newSession = new ExpertToExpertSession(sessionData);
  await newSession.save();
  const consultingExpert = await Expert.findById(newSession.consultingExpertID);

  // Send email notifications for booking confirmation
  try {
    // Email to the expert who booked the session
    await sendEmail({
      to: email, // Use the email directly from the request body
      subject: "Session Booking Confirmation - Expert to Expert",
      html: `<h1>Booking Confirmed!</h1>
             <p>Hello ${firstName},</p>
             <p>Your expert-to-expert session with ${consultingExpert.firstName} ${consultingExpert.lastName} is booked and is awaiting confirmation from the consulting expert.</p>
             <p>Session ID: ${newSession._id}</p>
             <p>Status: ${newSession.status}</p>
             <p>Amount Paid: ${newSession.paymentAmount} SAR (via ${newSession.paymentMethod})</p>
             ${newSession.giftCardAmountRedeemed > 0 ? `<p>Gift Card Redeemed: ${newSession.giftCardAmountRedeemed} SAR</p>` : ''}
             <p>Thank you for using our platform.</p>`
    });
    console.log(`Confirmation email sent to booking expert: ${email}`);

    // Email to the consulting expert being booked
    if (consultingExpert?.email) {
      await sendEmail({
        to: consultingExpert.email,
        subject: "New Expert Session Request",
        html: `<h1>New Session Request</h1>
               <p>Hello ${consultingExpert.firstName},</p>
               <p>You have a new expert-to-expert session request from ${firstName} ${lastName}.</p>
               <p>Please log in to accept or decline.</p>
               <p>Session ID: ${newSession._id}</p>
               <p>Area of Expertise: ${areaOfExpertise}</p>
               <p>Duration: ${duration}</p>
               ${note ? `<p>Note: ${note}</p>` : ''}`
      });
      console.log(`Notification email sent to consulting expert: ${consultingExpert.email}`);
    } else {
      console.warn('No email address found for the consulting expert');
    }
  } catch (emailError) {
    console.error("Failed to send booking confirmation emails for E2E session:", emailError);
    // Do not fail the booking if email sending fails, just log it
  }

  const sessionObj = newSession.toObject ? newSession.toObject() : { ...newSession };
  sessionObj.consultingExpertID = (newSession.consultingExpertID?._id?.toString?.() || newSession.consultingExpertID?.toString?.() || newSession.consultingExpertID || "");
  sessionObj.expertId = (newSession.expertId?._id?.toString?.() || newSession.expertId?.toString?.() || newSession.expertId || "");
  return res.status(201).json({
    message: `Session booked successfully. Status: ${newSession.status}, Payment Status: ${newSession.paymentStatus}.`,
    session: sessionObj,
  });
});

// Payment webhook handler - This was originally for TAP session payments.
// It might be repurposed or a new one created if TAP is used for WALLET TOP-UPs
// and needs to update a transaction record related to wallet top-up.
// For gift card purchases, there's a separate webhook in giftcard.controller.
// ... (handlePaymentWebhook function - can be kept for reference or if wallet top-up uses a similar mechanism)

// Payment success handler - API endpoint for success redirect
// Also originally for TAP session payments.
// ... (handlePaymentSuccess function - can be kept for reference)

// Update your acceptSession function in expert controller to include user meeting link

// Generate a unique meeting number for Zoom Video SDK
const generateMeetingNumber = () => {
  return Math.floor(Math.random() * 9000000000) + 1000000000; // 10-digit number
};

// Generate a consistent session password for the meeting
const generateZoomPassword = () => {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let password = "";
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password; // Always exactly 8 characters
};



const acceptSession = asyncHandler(async (req, res) => {
  const { id, selectedDate, selectedTime } = req.body;

  try {
    // 1️⃣ Find session only in UserToExpertSession
    const session = await UserToExpertSession.findById(id)
      .populate("userId", "firstName lastName email")
      .populate("expertId", "firstName lastName email");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // 2️⃣ Update slots and status
    session.slots = [{ selectedDate, selectedTime }];
    session.status = "confirmed";

    // 3️⃣ Generate Zoom Video SDK meeting details
    const meetingNumber = generateMeetingNumber();
    const zoomPassword = generateZoomPassword();

    session.zoomMeetingId = meetingNumber.toString();
    session.zoomSessionName = `session_${session._id}_${meetingNumber}`;
    session.zoomPassword = zoomPassword;
    session.zoomMeetingLink = `/expertpanel/sessioncall?meetingId=${meetingNumber}&sessionId=${session._id}`;
    session.userMeetingLink = `/userpanel/sessioncall?meetingId=${meetingNumber}&sessionId=${session._id}`;

    // 4️⃣ Payout processing (if price > 0 and not already processed)
    if (!session.payoutProcessed && session.price > 0) {
      const expertDoc = await Expert.findById(session.expertId._id);
      if (expertDoc) {
        const averageRating = expertDoc.averageRating || 0;
        const expertSharePercentage = averageRating >= 4 ? 0.7 : 0.5;
        const expertShare = session.price * expertSharePercentage;
        const platformFee = session.price - expertShare;

        session.expertPayoutAmount = expertShare;
        session.platformFeeAmount = platformFee;
        session.payoutProcessed = true;

        expertDoc.wallets = expertDoc.wallets || { earning: { balance: 0, ledger: [] }, spending: { balance: 0, ledger: [] } };
        expertDoc.wallets.earning.balance += expertShare;

        const creditTx = await Transaction.create({
          expertId: expertDoc._id,
          type: 'DEPOSIT',
          amount: expertShare,
          status: 'COMPLETED',
          paymentMethod: 'WALLET',
          description: 'User-to-Expert session earnings (confirmed)',
          metadata: { origin: 'user_to_expert_session', sessionId: session._id }
        });

        expertDoc.wallets.earning.ledger.push(creditTx._id);
        expertDoc.transactions = expertDoc.transactions || [];
        expertDoc.transactions.push(creditTx._id);
        await expertDoc.save();
      }
    }

    await session.save();

    // 5️⃣ Send confirmation email to the user
    try {
      const recipientEmail = session.userId.email;
      const recipientFirstName = session.userId.firstName;
      const expertFirstName = session.expertId.firstName;
      const expertLastName = session.expertId.lastName;

      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: "Session Confirmed!",
          html: `
            <h1>Your Session is Confirmed!</h1>
            <p>Hello ${recipientFirstName},</p>
            <p>Your session with expert ${expertFirstName} ${expertLastName} has been confirmed.</p>
            <p>Session ID: ${session._id}</p>
            <p>You can join the session here: 
              <a href="${process.env.FRONTEND_URL}${session.userMeetingLink}">
                ${process.env.FRONTEND_URL}${session.userMeetingLink}
              </a>
            </p>
            <p>Please be ready a few minutes before your session starts.</p>
            <p>Thank you for using our platform.</p>
          `,
        });
      }
    } catch (emailError) {
      console.error(`Failed to send confirmation email:`, emailError);
    }

    res.status(200).json({
      success: true,
      message: "Session accepted and confirmed successfully",
      session,
    });
  } catch (error) {
    console.error("Error accepting session:", error);
    res.status(500).json({
      success: false,
      message: "Error accepting session",
      error: error.message,
    });
  }
});




// New endpoint to generate Video SDK signature when joining
const generateVideoSDKAuth = asyncHandler(async (req, res) => {
  const { meetingNumber, role = 0 } = req.body;

  try {
    const authData = generateVideoSDKSignature(meetingNumber, role);

    // Secure logging - only log non-sensitive information
    console.log('=== GENERATE VIDEO SDK TOKEN ===');
    console.log(`Meeting ID: ${meetingNumber}`);
    console.log('✅ Generated token successfully');

    res.status(200).json({
      success: true,
      ...authData,
    });
  } catch (error) {
    console.error("Error generating Video SDK signature:", error);
    res.status(500).json({
      message: "Failed to generate Video SDK authentication",
      error: error.message,
    });
  }
});

// Complete session endpoint - updates status to "completed"
const completeSession = asyncHandler(async (req, res) => {
  const { sessionId, endTime, status = "completed", actualDuration } = req.body;

  try {
    console.log("Completing session:", {
      sessionId,
      endTime,
      status,
      actualDuration,
    });

    // Try to find the session in ExpertToExpertSession first
    let session = await ExpertToExpertSession.findById(sessionId);
    let sessionType = "expert-to-expert";

    // If not found, try UserToExpertSession
    if (!session) {
      session = await UserToExpertSession.findById(sessionId);
      sessionType = "user-to-expert";
    }

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    // Update session with completion details
    const updateData = {
      status: status,
      endTime: new Date(endTime),
      completedAt: new Date(),
      actualDuration: actualDuration || session.duration,
    };

    // Update the session
    const updatedSession =
      sessionType === "expert-to-expert"
        ? await ExpertToExpertSession.findByIdAndUpdate(sessionId, updateData, {
            new: true,
          })
        : await UserToExpertSession.findByIdAndUpdate(sessionId, updateData, {
            new: true,
          });

    console.log("Session updated successfully:", {
      sessionId,
      sessionType,
      status: updatedSession.status,
      endTime: updatedSession.endTime,
    });

    res.status(200).json({
      success: true,
      message: "Session completed successfully",
      session: updatedSession,
      sessionType: sessionType,
    });
  } catch (error) {
    console.error("Error completing session:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete session",
      error: error.message,
    });
  }
});

// Alternative endpoint format (PUT /session/:id/complete)
const completeSessionById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status = "completed", endTime, actualDuration } = req.body;

  try {
    console.log("Completing session by ID:", {
      id,
      status,
      endTime,
      actualDuration,
    });

    // Try both session types
    let session = await ExpertToExpertSession.findById(id);
    let sessionType = "expert-to-expert";

    if (!session) {
      session = await UserToExpertSession.findById(id);
      sessionType = "user-to-expert";
    }

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    // Update session
    const updateData = {
      status: status,
      endTime: new Date(endTime || new Date()),
      completedAt: new Date(),
      actualDuration: actualDuration || session.duration,
    };

    const updatedSession =
      sessionType === "expert-to-expert"
        ? await ExpertToExpertSession.findByIdAndUpdate(id, updateData, {
            new: true,
          })
        : await UserToExpertSession.findByIdAndUpdate(id, updateData, {
            new: true,
          });

    res.status(200).json({
      success: true,
      message: "Session completed successfully",
      session: updatedSession,
      sessionType: sessionType,
    });
  } catch (error) {
    console.error("Error completing session by ID:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete session",
      error: error.message,
    });
  }
});

// Get session details endpoint (if not already exists)
const getSessionDetails = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  try {
    // Try to find in both collections
    let session = await ExpertToExpertSession.findById(sessionId)
      .populate("expertId", "firstName lastName email")
      .populate("consultingExpertID", "firstName lastName email");

    let sessionType = "expert-to-expert";

    if (!session) {
      session = await UserToExpertSession.findById(sessionId)
        .populate("userId", "firstName lastName email")
        .populate("expertId", "firstName lastName email");
      sessionType = "user-to-expert";
    }

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    // Convert session to plain object and ensure IDs are included as strings
    const sessionObj = session.toObject ? session.toObject() : { ...session };
    
    // Always include these fields as strings
    sessionObj.consultingExpertID = (
      session.consultingExpertID?._id?.toString?.() ||
      session.consultingExpertID?.toString?.() ||
      session.consultingExpertID ||
      (sessionObj.consultingExpertID?._id?.toString?.() || sessionObj.consultingExpertID?.toString?.() || sessionObj.consultingExpertID) ||
      ""
    );
    
    sessionObj.expertId = (
      session.expertId?._id?.toString?.() ||
      session.expertId?.toString?.() ||
      session.expertId ||
      (sessionObj.expertId?._id?.toString?.() || sessionObj.expertId?.toString?.() || sessionObj.expertId) ||
      ""
    );
    
    if (sessionObj.userId) {
      sessionObj.userId = sessionObj.userId?._id?.toString?.() || sessionObj.userId?.toString?.() || sessionObj.userId;
    }

    // Debug log to verify outgoing response
    console.log('Sending session details:', sessionObj);

    res.status(200).json({
      success: true,
      session: sessionObj,
      sessionType: sessionType,
      duration: session.duration // Ensure duration is at the top level
    });
  } catch (error) {
    console.error("Error fetching session details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch session details",
      error: error.message,
    });
  }
});

// // Helper: Convert "Quick - 15min" → 15
// const getDurationInMinutes = (durationStr) => {
//   if (typeof durationStr === "number") return durationStr;
//   const match = durationStr.match(/(\d+)/);
//   return match ? parseInt(match[1], 10) : 15;
// };

// To decline the user request
const declineSession = asyncHandler(async (req, res) => {
  const { id } = req.body; // Session ID
  const decliningExpertId = req.user?._id; // Expert initiating the decline

  if (!decliningExpertId) {
    throw new ApiError(401, "Expert not authenticated.");
  }

  let session = await ExpertToExpertSession.findById(id);
  let sessionType = "expert-to-expert";
  let bookerId; // To know whose wallet to refund

  if (session) {
    // Ensure the declining expert is the consultingExpertID for E2E sessions
    if (
      session.consultingExpertID.toString() !== decliningExpertId.toString()
    ) {
      throw new ApiError(
        403,
        "Forbidden: You are not the consulting expert for this E2E session."
      );
    }
    bookerId = session.expertId; // The expert who booked the session
  } else {
    session = await UserToExpertSession.findById(id);
    sessionType = "user-to-expert";
    if (session) {
      // Ensure the declining expert is the expertId for U2E sessions
      if (session.expertId.toString() !== decliningExpertId.toString()) {
        throw new ApiError(
          403,
          "Forbidden: You are not the expert for this U2E session."
        );
      }
      bookerId = session.userId; // The user who booked the session
    } else {
      throw new ApiError(404, "Session not found.");
    }
  }

  if (session.status === "rejected") {
    return res.status(400).json({ message: "Session already rejected." });
  }

  const oldStatus = session.status;
  session.status = "rejected";

  // Refund logic for wallet payments (Option B: Gift cards not refunded to card)
  if (
    session.paymentStatus === "completed" &&
    session.paymentAmount > 0 &&
    bookerId
  ) {
    // paymentAmount stores the amount paid from wallet after gift card (if any)
    const booker = await Expert.findById(bookerId); // Booker is always a User (even if an expert booking another expert)
    if (booker) {
      booker.walletBalance =
        (booker.walletBalance || 0) + session.paymentAmount;
      await booker.save();
      session.paymentStatus = "refunded_to_wallet"; // New status to indicate wallet refund
      console.log(
        `Refunded ${session.paymentAmount} to user ${bookerId} wallet for declined session ${session._id}. New balance: ${booker.walletBalance}`
      );
      // TODO: Add a transaction record for this refund
    } else {
      console.error(
        `Booker with ID ${bookerId} not found for wallet refund on session ${session._id}.`
      );
      // Decide how to handle this: proceed with rejection but log, or throw error?
      // For now, we'll proceed with rejection and log the refund issue.
      session.paymentStatus = "refund_failed_booker_not_found";
    }
  } else if (
    session.paymentStatus === "completed" &&
    session.giftCardAmountRedeemed > 0 &&
    session.paymentAmount === 0
  ) {
    // Paid fully by gift card, no wallet refund as per Option B.
    // Mark payment as 'gift_card_not_refunded' or similar if you need to track this state.
    session.paymentStatus = "declined_gift_card_payment";
  }

  await session.save();

  // TODO: Send email notification to the booker about the session rejection and refund (if any).

  res.status(200).json({
    message: "Session rejected successfully.",
    session,
  });
});

const submitRatingAndProcessPayout = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { rating, comment } = req.body;
  const raterMongoId = req.user?._id;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Invalid rating. Must be between 1 and 5." });
  }

  if (!raterMongoId) {
    return res.status(401).json({ message: "User not authenticated." });
  }

  try {
    // Fetch the session (user-to-expert session in this case)
    let session = await UserToExpertSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    let ratedExpertId = session.expertId;
    let raterType = "User"; // The user is rating the expert

    // Authorization for user-to-expert session
    if (session.userId.toString() !== raterMongoId.toString()) {
      return res.status(403).json({
        message: "Forbidden: You did not participate in this user-to-expert session.",
      });
    }

    if (session.status !== "completed") {
      return res.status(400).json({ message: "Session must be 'completed' before submitting a rating." });
    }

    // Check if a Rating document already exists for this specific context in the ratings collection
    const existingRatingDoc = await Rating.findOne({
      expertId: ratedExpertId,
      raterId: raterMongoId,
      sessionType: "user-to-expert",
    });

    // If no existing rating document exists, proceed with the new rating
    const newRating = new Rating({
      expertId: ratedExpertId,
      raterId: raterMongoId,
      sessionId: session._id, // Save the session ID
      sessionModelName: session.constructor.modelName, // Save the model name (e.g., 'UserToExpertSession')
      sessionType: "user-to-expert",
      rating: rating,
      comment: comment,
      raterType: raterType,
    });
    await newRating.save();

    // Update session document
    session.rating = rating; // Keep numeric rating on session for payout calculation
    session.status = "Rating Submitted";

    // Increment number of ratings
    const expertDoc = await Expert.findById(ratedExpertId);
    if (!expertDoc) {
      return res.status(404).json({ message: "Expert not found." });
    }

    // Increment the number of ratings
    expertDoc.numberOfRatings += 1;

    // Incrementally calculate the new average rating
    const previousAverageRating = expertDoc.averageRating || 0; // Default to 0 if not set
    const previousNumberOfRatings = expertDoc.numberOfRatings - 1; // Before this new rating

    // Calculate new average rating
    const newAverageRating = (previousAverageRating * previousNumberOfRatings + rating) / expertDoc.numberOfRatings;

    // Update the expert's average rating and ratings array
    expertDoc.averageRating = newAverageRating;
    expertDoc.ratings.push(newRating._id); // Add the new rating to the expert's ratings array

    // Save the expert model with the updated ratings and average rating
    await expertDoc.save();

    // Save the updated session
    await session.save();

    res.status(200).json({
      message: "Rating submitted successfully.",
      sessionData: session, // Send back updated session
      ratingData: newRating, // Send back new rating document
    });
  } catch (error) {
    console.error("Error submitting rating:", error);
    res.status(500).json({
      message: "An error occurred while submitting the rating.",
      error: error.message,
    });
  }
});


const getExpertPayoutHistory = asyncHandler(async (req, res) => {
  const expertId = req.user?._id;

  if (!expertId) {
    return res.status(401).json({ message: "Expert not authenticated." });
  }

  try {
    const expertToExpertSessions = await ExpertToExpertSession.find({
      consultingExpertID: expertId,
      payoutProcessed: true,
    })
      .populate("expertId", "firstName lastName") // The expert who booked this expert
      .sort({ updatedAt: -1 }); // Sort by when the payout was processed or session updated

    const userToExpertSessions = await UserToExpertSession.find({
      expertId: expertId,
      payoutProcessed: true,
    })
      .populate("userId", "firstName lastName") // The user who booked this expert
      .sort({ updatedAt: -1 });

    const formattedE2ESessions = expertToExpertSessions.map((session) => ({
      _id: session._id,
      sessionDate:
        session.slots &&
        session.slots.length > 0 &&
        session.slots[0].selectedDate
          ? session.slots[0].selectedDate
          : session.createdAt,
      rating: session.rating,
      sessionFee: session.price,
      expertEarnings: session.expertPayoutAmount,
      platformFeeAmount: session.platformFeeAmount,
      duration: session.duration,
      processedDateTime: session.updatedAt,
      status: session.status,
      sessionType: "expert-to-expert",
      participantName: session.expertId
        ? `${session.expertId.firstName} ${session.expertId.lastName}`
        : "N/A",
    }));

    const formattedU2ESessions = userToExpertSessions.map((session) => ({
      _id: session._id,
      sessionDate:
        session.slots &&
        session.slots.length > 0 &&
        session.slots[0].selectedDate
          ? session.slots[0].selectedDate
          : session.createdAt,
      rating: session.rating,
      sessionFee: session.price,
      expertEarnings: session.expertPayoutAmount,
      platformFeeAmount: session.platformFeeAmount,
      duration: session.duration,
      processedDateTime: session.updatedAt,
      status: session.status,
      sessionType: "user-to-expert",
      participantName: session.userId
        ? `${session.userId.firstName} ${session.userId.lastName}`
        : "N/A",
    }));

    const combinedHistory = [...formattedE2ESessions, ...formattedU2ESessions];
    combinedHistory.sort(
      (a, b) => new Date(b.processedDateTime) - new Date(a.processedDateTime)
    );

    res.status(200).json({ payouts: combinedHistory });
  } catch (error) {
    console.error("Error fetching expert payout history:", error);
    res.status(500).json({
      message: "An error occurred while fetching payout history.",
      error: error.message,
    });
  }
});

const markSessionAsCompleted = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const loggedInUserId = req.user?._id;

  if (!loggedInUserId) {
    return res.status(401).json({ message: "User not authenticated." });
  }

  try {
    let session = await ExpertToExpertSession.findById(sessionId);
    let sessionType = "expert-to-expert";

    if (!session) {
      session = await UserToExpertSession.findById(sessionId);
      sessionType = "user-to-expert";
    }

    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    // Authorization: Check if the logged-in user is part of the session
    let isParticipant = false;
    if (sessionType === "expert-to-expert") {
      if (
        session.expertId.toString() === loggedInUserId.toString() ||
        session.consultingExpertID.toString() === loggedInUserId.toString()
      ) {
        isParticipant = true;
      }
    } else {
      // user-to-expert
      if (
        session.userId.toString() === loggedInUserId.toString() ||
        session.expertId.toString() === loggedInUserId.toString()
      ) {
        isParticipant = true;
      }
    }

    if (!isParticipant) {
      return res
        .status(403)
        .json({
          message: "Forbidden: You are not a participant in this session.",
        });
    }

    if (session.status !== "confirmed") {
      return res.status(400).json({
        message: `Session status must be 'confirmed' to mark as completed. Current status: ${session.status}`,
      });
    }

    session.status = "completed";
    await session.save();

    res.status(200).json({
      message: "Session marked as completed successfully.",
      session,
    });
  } catch (error) {
    console.error("Error marking session as completed:", error);
    res.status(500).json({
      message: "An error occurred while marking the session as completed.",
      error: error.message,
    });
  }
});

// Add this new function after the existing functions
const sendSessionStatusEmail = async (session, status) => {
  try {
    const consultingExpert = await Expert.findById(
      session.consultingExpertID
    ).select("firstName lastName");
    const subject =
      status === "confirmed" ? "Session Confirmed" : "Session Rejected";
    const message =
      status === "confirmed"
        ? `Your session with expert ${consultingExpert.firstName} ${consultingExpert.lastName} has been confirmed.`
        : `Your session with expert ${consultingExpert.firstName} ${consultingExpert.lastName} has been rejected.`;

    await sendEmail({
      to: session.email,
      subject: subject,
      html: `<h1>${subject}</h1>
             <p>Hello ${session.firstName},</p>
             <p>${message}</p>
             <p>Session ID: ${session._id}</p>
             <p>Thank you for using our platform.</p>`,
    });
  } catch (error) {
    console.error(`Failed to send ${status} email notification:`, error);
  }
};

// Update the updateSessionStatus function to include email notification
const updateSessionStatus = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { status } = req.body;

  const session = await ExpertToExpertSession.findById(sessionId);
  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  session.status = status;
  await session.save();

  // Send email notification for confirmed or rejected status
  if (status === "confirmed" || status === "rejected") {
    await sendSessionStatusEmail(session, status);
  }

  res.status(200).json({
    success: true,
    message: `Session status updated to ${status}`,
    session,
  });
});

export {
  bookExpertToExpertSession,
  getMySessions,
  acceptSession,
  declineSession,
  getMyBookings,
  getExpertBookedSlots,
  submitRatingAndProcessPayout,
  getExpertPayoutHistory,
  markSessionAsCompleted,
  generateVideoSDKAuth,
  completeSession,
  completeSessionById,
  getSessionDetails,
  updateSessionStatus,
};
