import { GiftCard } from '../model/giftcard.model.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { User } from '../model/user.model.js'; // For fetching purchaser details if logged in
import axios from 'axios'; // For Tap payment
import dotenv from 'dotenv';
import nodemailer from 'nodemailer'; // Added nodemailer import

// Updated sendEmail function with Nodemailer
const sendEmail = async ({ to, subject, html }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail', // or your SMTP provider details
      auth: {
        user: process.env.ADMIN_MAIL_USER, // Your email address from .env
        pass: process.env.ADMIN_MAIL_PASS, // Your email password or app password from .env
      },
    });

    const mailOptions = {
      from: `"Shourk" <${process.env.ADMIN_EMAIL}>`, // Sender address using ADMIN_EMAIL
      to: to,
      subject: subject,
      html: html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Actual Email sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending actual email:", error);
    // Decide if you want to throw the error or handle it silently
    // For now, re-throwing to indicate failure to the caller, which might be important for debugging
    throw new ApiError(500, "Failed to send email", [error.message]); 
  }
};

dotenv.config();

// Helper function to create a TAP payment for gift cards
const createGiftCardTapPayment = async (giftCardData, successRedirectUrl, cancelRedirectUrl) => {
  try {
    const amountForTap = parseFloat(giftCardData.amount); // USE: Send the amount in major currency unit (e.g., SAR)

    if (isNaN(amountForTap) || amountForTap <= 0) {
      throw new Error("Invalid gift card amount. Amount must be a positive number.");
    }

    const payload = {
      amount: amountForTap, // Send the amount as is (e.g., 200 for 200 SAR)
      currency: "SAR", // Or your default currency
      customer: {
        first_name: giftCardData.purchaserName.split(' ')[0] || 'GiftCard',
        last_name: giftCardData.purchaserName.split(' ').slice(1).join(' ') || 'Purchaser',
        email: giftCardData.purchaserEmail,
        // Phone number is often required by payment gateways, adjust as needed
        // phone: { country_code: "+966", number: "500000000" } // Placeholder
      },
      source: { id: "src_all" }, 
      redirect: {
        url: successRedirectUrl 
      },
      post: {
        url: cancelRedirectUrl // For payment failures/cancellations by Tap
      },
      metadata: {
        giftCardId: giftCardData._id.toString(),
        type: "gift_card_purchase"
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
    console.error("Error creating TAP payment for gift card:", error.response?.data || error.message);
    const tapErrorMessage = error.response?.data?.errors?.[0]?.description || error.response?.data?.message || error.message;
    throw new Error("Payment gateway error: " + tapErrorMessage);
  }
};

export const purchaseGiftCard = asyncHandler(async (req, res) => {
  const {
    amount,
    recipientEmail,
    recipientPhone,
    recipientMessage,
    sendAnonymously,
    redirect // <-- Accept redirect from frontend
  } = req.body;

  const loggedInUser = req.user;

  // Validate input
  if (!amount || parseFloat(amount) <= 0) {
    throw new ApiError(400, "Invalid gift card amount.");
  }
  if (!recipientEmail) {
    throw new ApiError(400, "Recipient email is required.");
  }
  if (recipientEmail && !/\S+@\S+\.\S+/.test(recipientEmail)) {
    throw new ApiError(400, "Invalid recipient email format.");
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new ApiError(400, "Amount must be a positive number.");
  }

  let purchaserName = "Anonymous";
  let purchaserEmail = "anonymous@example.com";
  let purchaserId = null;

  if (sendAnonymously === false || sendAnonymously === undefined) {
    if (!loggedInUser) {
      throw new ApiError(401, "User must be logged in to send a non-anonymous gift card.");
    }
    purchaserName = `${loggedInUser.firstName || ''} ${loggedInUser.lastName || ''}`.trim() || loggedInUser.email;
    if (!purchaserName) purchaserName = "Valued Customer";
    purchaserEmail = loggedInUser.email;
    purchaserId = loggedInUser._id;
  }

  let redemptionCode;
  let existingCode = true;
  while (existingCode) {
    redemptionCode = GiftCard.generateRedemptionCode();
    existingCode = await GiftCard.findOne({ redemptionCode });
  }

  const giftCardData = {
    amount: parsedAmount,
    originalAmount: parsedAmount,
    balance: parsedAmount,
    purchaserName,
    purchaserEmail,
    purchaserId,
    recipientName: "Valued Recipient",
    recipientEmail,
    recipientPhone: recipientPhone || null,
    recipientMessage: recipientMessage || "",
    status: sendAnonymously ? 'anonymous_pending_payment' : 'pending_payment',
    sendAnonymously: !!sendAnonymously,
    redemptionCode,
  };

  const newGiftCard = new GiftCard(giftCardData);
  await newGiftCard.save();

  try {
    // Use redirect from frontend if provided, else fallback to userpanel
    const baseUrl = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectPath = redirect || req.query.redirect || '/userpanel/giftcard-purchase-status';
    const successRedirectUrl = `${baseUrl}${redirectPath}?type=giftcard&giftCardId=${newGiftCard._id}`;
    const tapPostUrl = `${process.env.BACKEND_URL}/api/giftcard/tap-webhook`;

    const paymentData = await createGiftCardTapPayment(
      newGiftCard,
      successRedirectUrl,
      tapPostUrl
    );

    newGiftCard.paymentId = paymentData.id;
    newGiftCard.paymentMethod = 'tap';
    await newGiftCard.save();

    res.status(201).json({
      message: "Gift card purchase initiated. Redirecting to payment.",
      giftCard: newGiftCard,
      paymentUrl: paymentData.transaction.url,
      paymentId: paymentData.id,
    });

  } catch (paymentError) {
    console.error("Payment initiation failed for gift card:", newGiftCard._id, paymentError);
    newGiftCard.status = 'payment_failed';
    newGiftCard.paymentStatus = 'failed_initiation';
    await newGiftCard.save();
    throw new ApiError(500, paymentError.message || "Failed to initiate payment for gift card.");
  }
});

// Webhook handler for Tap payments (for gift cards)
// Ensure this route is accessible by Tap servers (publicly available)
export const handleGiftCardTapWebhook = asyncHandler(async (req, res) => {
  const { id, status, metadata, amount } = req.body; // `id` here is the Tap charge ID
  console.log("[GiftCard Webhook] Received data:", req.body);

  if (!metadata || !metadata.giftCardId || metadata.type !== 'gift_card_purchase') {
    console.warn("[GiftCard Webhook] Invalid or missing metadata:", metadata);
    return res.status(400).json({ message: "Invalid webhook: missing giftCardId or incorrect type." });
  }

  const giftCard = await GiftCard.findById(metadata.giftCardId);
  if (!giftCard) {
    console.error("[GiftCard Webhook] Gift card not found with ID:", metadata.giftCardId);
    return res.status(404).json({ message: "Gift card not found." });
  }

  // Prevent processing old/stale webhooks if already handled by success redirect or another webhook
  if (giftCard.status === 'active' || giftCard.status === 'redeemed') {
    console.log(`[GiftCard Webhook] Gift card ${giftCard._id} already in status ${giftCard.status}. Webhook for charge ${id} ignored.`);
    return res.status(200).json({ success: true, message: "Webhook already processed or gift card is active/redeemed." });
  }

  giftCard.paymentId = id; // Ensure paymentId is updated with the charge ID from webhook
  giftCard.paymentStatus = status.toLowerCase();

  if (status === "CAPTURED" || status === "PAID" || status === "AUTHORIZED") {
    giftCard.status = "active";
    giftCard.balance = giftCard.originalAmount; // Confirm balance on successful payment
    
    await giftCard.save();
    console.log(`[GiftCard Webhook] Gift card ${giftCard._id} activated. Charge ID: ${id}`);

    // Send emails AFTER saving the status
    try {
      // Email to Purchaser
      let purchaserConfirmationSubject = "Your Gift Card Purchase Confirmation";
      let purchaserConfirmationHtml = `<h1>Thank You!</h1><p>You have successfully purchased a gift card for ${giftCard.recipientEmail} (valued at ${giftCard.originalAmount} SAR).</p><p>Gift Card Code: <strong>${giftCard.redemptionCode}</strong></p>`;
      
      if (giftCard.sendAnonymously) {
        purchaserConfirmationHtml += `<p>Your gift has been sent anonymously. The recipient will not see your name.</p>`;
      } else {
        purchaserConfirmationHtml += `<p>Recipient: ${giftCard.recipientEmail}</p><p>This code has been sent to the recipient, ${giftCard.recipientName || 'them'}, with your name.</p>`;
      }

      await sendEmail({
        to: giftCard.purchaserEmail, // This is always the actual purchaser's email
        subject: purchaserConfirmationSubject,
        html: purchaserConfirmationHtml
      });

      // Email to Recipient
      let recipientSubject = giftCard.sendAnonymously ? "You\'ve Received a Gift Card!" : `You\'ve Received a Gift Card from ${giftCard.purchaserName}!`;
      let recipientHtml = `<h1>You\'ve Received a Gift Card!</h1>`;
      if (giftCard.sendAnonymously) {
        recipientHtml += `<p>Someone has sent you a gift card worth ${giftCard.originalAmount} SAR!</p>`;
      } else {
        recipientHtml += `<p>${giftCard.purchaserName} has sent you a gift card worth ${giftCard.originalAmount} SAR!</p>`;
      }
      recipientHtml += `<p>Your Redemption Code: <strong>${giftCard.redemptionCode}</strong></p>${giftCard.recipientMessage ? `<p>Message from sender: ${giftCard.recipientMessage}</p>` : ''}<p>Redeem it on your next booking at <a href="https://www.shourk.com" target="_blank">www.shourk.com</a></p>`;

      
      await sendEmail({
        to: giftCard.recipientEmail,
        subject: recipientSubject,
        html: recipientHtml
      });
    } catch (emailError) {
        console.error(`[GiftCard Webhook] Failed to send emails for gift card ${giftCard._id} after activation:`, emailError);
        // Don't fail the webhook for email errors, but log it.
    }

  } else if ([ "FAILED", "CANCELLED", "DECLINED", "VOID", "EXPIRED"].includes(status)) {
    giftCard.status = "payment_failed";
    console.log(`[GiftCard Webhook] Payment failed/cancelled for gift card ${giftCard._id}. Status: ${status}, Charge ID: ${id}`);
    await giftCard.save();
  } else {
    console.log(`[GiftCard Webhook] Unhandled payment status '${status}' for gift card ${giftCard._id}. Charge ID: ${id}. Gift card status remains '${giftCard.status}'.`);
    // Optionally save unknown statuses if needed for audit
    // giftCard.status = "unknown_payment_status"; 
    // await giftCard.save();
  }
  
  res.status(200).json({ success: true });
});

// Optional: Payment success handler (if frontend redirects here after Tap)
// This can provide a faster feedback loop to the user than waiting for the webhook,
// but the webhook should be the source of truth for activating the gift card.
export const handleGiftCardPaymentSuccess = asyncHandler(async (req, res) => {
    const { giftCardId, tap_id } = req.query; // tap_id is the charge_id from Tap

    if (!giftCardId || !tap_id) {
        throw new ApiError(400, "Missing giftCardId or tap_id in query parameters.");
    }

    try {
        // Verify payment status with TAP API as a precaution, though webhook is primary
        const paymentVerification = await axios.get(
            `https://api.tap.company/v2/charges/${tap_id}`,
            {
                headers: { "Authorization": `Bearer ${process.env.TAP_SECRET_KEY}` }
            }
        );

        const paymentStatus = paymentVerification.data.status;
        const chargeDetails = paymentVerification.data;

        const giftCard = await GiftCard.findById(giftCardId);
        if (!giftCard) {
            throw new ApiError(404, "Gift card not found.");
        }

        // If webhook hasn't processed yet, update based on this verification
        if (
            (giftCard.status === 'pending_payment' || giftCard.status === 'anonymous_pending_payment') && 
            (paymentStatus === "CAPTURED" || paymentStatus === "PAID" || paymentStatus === "AUTHORIZED")
        ) {
            giftCard.status = giftCard.sendAnonymously ? "anonymous_active" : "active";
            giftCard.paymentId = tap_id;
            giftCard.paymentStatus = paymentStatus.toLowerCase();
            giftCard.balance = giftCard.originalAmount;
            await giftCard.save();
            console.log(`[GiftCard Success Handler] Gift card ${giftCard._id} activated via success redirect. Charge ID: ${tap_id}`);

            // Send emails (idempotency handled by checking status or using a flag if an email service is used)
             try {
                let purchaserConfSubjectSuccess = "Your Gift Card Purchase Confirmation (Payment Success)";
                let purchaserConfHtmlSuccess = `<h1>Thank You!</h1><p>Your payment was successful. You have purchased a gift card for ${giftCard.recipientEmail} (valued at ${giftCard.originalAmount} SAR).</p><p>Gift Card Code: <strong>${giftCard.redemptionCode}</strong></p>`;
                
                if (giftCard.sendAnonymously) {
                    purchaserConfHtmlSuccess += `<p>Your gift has been sent anonymously. The recipient will not see your name.</p>`;
                } else {
                    purchaserConfHtmlSuccess += `<p>Recipient: ${giftCard.recipientEmail}</p><p>This code has been sent to the recipient, ${giftCard.recipientName || 'them'}, with your name.</p>`;
                }

                await sendEmail({
                    to: giftCard.purchaserEmail,
                    subject: purchaserConfSubjectSuccess,
                    html: purchaserConfHtmlSuccess
                });

                let recipientSubjectSuccess = giftCard.sendAnonymously ? "You\'ve Received a Gift Card! (Payment Success)" : `You\'ve Received a Gift Card from ${giftCard.purchaserName}! (Payment Success)`;
                let recipientHtmlSuccess = `<h1>You\'ve Received a Gift Card!</h1>`;
                if (giftCard.sendAnonymously) {
                    recipientHtmlSuccess += `<p>Someone has sent you a gift card worth ${giftCard.originalAmount} SAR!</p>`;
                } else {
                    recipientHtmlSuccess += `<p>${giftCard.purchaserName} has sent you a gift card worth ${giftCard.originalAmount} SAR!</p>`;
                }
                recipientHtmlSuccess += `<p>Your Redemption Code: <strong>${giftCard.redemptionCode}</strong></p>${giftCard.recipientMessage ? `<p>Message from sender: ${giftCard.recipientMessage}</p>` : ''}<p>Redeem it on your next booking at <a href="https://www.shourk.com" target="_blank">www.shourk.com</a></p>`;
                
                await sendEmail({
                    to: giftCard.recipientEmail,
                    subject: recipientSubjectSuccess,                    
                    html: recipientHtmlSuccess
                });
            } catch (emailError) {
                console.error(`[GiftCard Success Handler] Failed to send emails for gift card ${giftCard._id}:`, emailError);
            }
            
            // Redirect user to a success page on the frontend
            // res.redirect(`${process.env.FRONTEND_URL}/giftcard-purchase-success?giftCardId=${giftCard._id}`);
            return res.status(200).json({ 
                success: true, 
                message: "Payment successful. Gift card activated.", 
                giftCardId: giftCard._id,
                status: giftCard.status
            });
        } else if (giftCard.status === 'active' || giftCard.status === 'anonymous_active') {
            // Already activated (likely by webhook)
             return res.status(200).json({ 
                success: true, 
                message: "Payment successful. Gift card is active.", 
                giftCardId: giftCard._id,
                status: giftCard.status
            });
        } else {
            // Payment not successful or status already reflects a failure
            // res.redirect(`${process.env.FRONTEND_URL}/giftcard-purchase-failed?giftCardId=${giftCard._id}&status=${paymentStatus}`);
            return res.status(400).json({
                success: false,
                message: `Payment not successful or in unexpected state. Tap status: ${paymentStatus}, Gift Card status: ${giftCard.status}`,
                tap_status: paymentStatus,
                gift_card_status: giftCard.status
            });
        }

    } catch (error) {
        console.error("Gift card payment success handler error:", error.response?.data || error.message);
        // res.redirect(`${process.env.FRONTEND_URL}/giftcard-purchase-error`);
        throw new ApiError(500, "Error processing payment success: " + (error.response?.data?.message || error.message));
    }
});

// Get Gift Card Details by Redemption Code
export const getGiftCardByCode = asyncHandler(async (req, res) => {
  const { redemptionCode } = req.params;

  if (!redemptionCode) {
    throw new ApiError(400, "Redemption code is required.");
  }

  const giftCard = await GiftCard.findOne({ 
    redemptionCode,
    status: { $in: ['active', 'anonymous_active'] } // Only allow fetching active gift cards by code for redemption purposes
  });

  if (!giftCard) {
    // Check if it exists but is not active to provide a more specific message
    const inactiveGiftCard = await GiftCard.findOne({ redemptionCode });
    if (inactiveGiftCard) {
        let message = "Gift card is not active.";
        if (inactiveGiftCard.status === 'redeemed') message = "Gift card has already been fully redeemed.";
        else if (inactiveGiftCard.status === 'expired') message = "Gift card has expired.";
        else if (inactiveGiftCard.status === 'pending_payment') message = "Gift card payment is pending.";
        else if (inactiveGiftCard.status === 'payment_failed') message = "Gift card payment failed.";
        throw new ApiError(404, message);
    }
    throw new ApiError(404, "Invalid or inactive gift card code.");
  }

  // Don't send sensitive payment details, etc.
  res.status(200).json({
    success: true,
    message: "Gift card details fetched successfully.",
    giftCard: {
        _id: giftCard._id,
        redemptionCode: giftCard.redemptionCode,
        amount: giftCard.amount, // Original amount
        balance: giftCard.balance, // Current balance
        recipientName: giftCard.recipientName,
        recipientEmail: giftCard.recipientEmail,
        status: giftCard.status,
        expiresAt: giftCard.expiresAt
        // Add any other fields frontend might need for display
    }
  });
});

// Internal function to apply/redeem a gift card (not directly an endpoint yet)
// This will be called by booking controllers
export const applyGiftCardToBooking = async (redemptionCode, sessionPrice) => {
  if (!redemptionCode || typeof sessionPrice !== 'number' || sessionPrice < 0) { // sessionPrice can be 0 for free sessions initially
    throw new Error("Invalid redemption code or session price.");
  }

  const giftCard = await GiftCard.findOne({ 
    redemptionCode,
    status: { $in: ['active', 'anonymous_active'] } 
  });

  if (!giftCard) {
    throw new Error("Gift card not found or not active."); // Simplified error
  }
  // No need to check giftCard.balance > 0 in the old way, as it's one-time use based on originalAmount
  // No need to check expiry here if it's a one-time use and deleted straight away.

  // The discount applied is the lesser of the session price or the gift card's original value.
  const actualRedeemedAmount = Math.min(sessionPrice, giftCard.originalAmount);

  // Gift card is considered used and will be deleted, regardless of full/partial use against this session price.
  await GiftCard.findByIdAndDelete(giftCard._id);

  return {
    success: true,
    redeemedAmount: actualRedeemedAmount, // The amount of discount applied in this transaction
    remainingBalance: 0, // Effectively zero as the card is deleted
    giftCardId: giftCard._id, // ID of the (now deleted) card
    newStatus: 'deleted_applied_one_time' // Custom status to indicate this specific action
  };
}; 