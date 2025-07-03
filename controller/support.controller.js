import { Support } from "../model/support.model.js";
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Admin email from env
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'sattam.amd87@gmail.com';

// Create nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.ADMIN_MAIL_USER, // your Gmail
    pass: process.env.ADMIN_MAIL_PASS  // your Gmail password or app password
  }
});

/**
 * Simple function to send email notification to admin
 * @param {String} subject - Email subject
 * @param {String} content - HTML content to include in email body
 * @returns {Promise} - Email send result
 */
const sendEmailToAdmin = async (subject, content) => {
  try {
    const mailOptions = {
      from: process.env.MAIL_USER,
      to: ADMIN_EMAIL,
      subject,
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
              <div style="background-color: #f8f8f8; padding: 15px; text-align: center; border-radius: 5px 5px 0 0;">
                <h1 style="color: #333; margin: 0;">AMD Admin Notification</h1>
              </div>
              <div style="padding: 20px;">
                ${content}
              </div>
              <div style="background-color: #f8f8f8; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 5px 5px;">
                <p>This is an automated message from your AMD application. Please do not reply to this email.</p>
              </div>
            </div>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Admin notification email sent to ${ADMIN_EMAIL}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending admin email:', error);
    // Don't fail the whole operation if email sending fails
    return false;
  }
};

/**
 * Controller for handling user feedback submissions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const GiveUsFeedback = async (req, res) => {
  const { email, phone, message } = req.body;

  try {
    // Validate required fields
    if (!email || !phone || !message) {
      return res.status(400).json({ 
        success: false,
        message: "All fields are required" 
      });
    }

    // Create and save feedback entry
    const support = new Support({
      email,
      phone,
      message,
      type: "feedback"
    });

    await support.save();
    
    // Send notification email to admin
    await sendEmailToAdmin(
      "New Feedback Received",
      `<h2>New User Feedback</h2>
       <p><strong>Email:</strong> ${email}</p>
       <p><strong>Phone:</strong> ${phone}</p>
       <p><strong>Message:</strong> ${message}</p>`
    );

    return res.status(200).json({ 
      success: true,
      message: "Feedback submitted successfully" 
    });
  } catch (error) {
    console.error("Error saving feedback:", error);
    return res.status(500).json({ 
      success: false,
      message: "Internal server error" 
    });
  }
};

/**
 * Controller for handling feature suggestions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const SuggestFeature = async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  try {
    // Validate required fields
    if (!email || !phone || !message || !subject) {
      return res.status(400).json({ 
        success: false,
        message: "Email, phone, feature name, and description are required" 
      });
    }

    // Create and save feature suggestion entry
    const support = new Support({
      name: name || "Anonymous",
      email,
      phone,
      subject,
      message,
      type: "feature"
    });

    await support.save();
    
    // Send notification email to admin
    await sendEmailToAdmin(
      "New Feature Suggestion",
      `<h2>New Feature Suggestion</h2>
       <p><strong>Name:</strong> ${name || "Anonymous"}</p>
       <p><strong>Email:</strong> ${email}</p>
       <p><strong>Phone:</strong> ${phone}</p>
       <p><strong>Feature Name:</strong> ${subject}</p>
       <p><strong>Description:</strong> ${message}</p>`
    );

    return res.status(200).json({ 
      success: true,
      message: "Feature suggestion submitted successfully" 
    });
  } catch (error) {
    console.error("Error saving feature suggestion:", error);
    return res.status(500).json({ 
      success: false,
      message: "Internal server error" 
    });
  }
};

/**
 * Controller for handling topic/expert suggestions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const SuggestTopic = async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  try {
    // Validate required fields
    if (!email || !phone || !message || !subject) {
      return res.status(400).json({ 
        success: false,
        message: "Email, phone, topic name, and details are required" 
      });
    }

    // Create and save topic suggestion entry
    const support = new Support({
      name: name || "Anonymous",
      email,
      phone,
      subject,
      message,
      type: "topic"
    });

    await support.save();
    
    // Send notification email to admin
    await sendEmailToAdmin(
      "New Topic/Expert Suggestion",
      `<h2>New Topic/Expert Suggestion</h2>
       <p><strong>Name:</strong> ${name || "Anonymous"}</p>
       <p><strong>Email:</strong> ${email}</p>
       <p><strong>Phone:</strong> ${phone}</p>
       <p><strong>Topic/Expert Name:</strong> ${subject}</p>
       <p><strong>Details:</strong> ${message}</p>`
    );

    return res.status(200).json({ 
      success: true,
      message: "Topic/Expert suggestion submitted successfully" 
    });
  } catch (error) {
    console.error("Error saving topic suggestion:", error);
    return res.status(500).json({ 
      success: false,
      message: "Internal server error" 
    });
  }
};

export { GiveUsFeedback, SuggestFeature, SuggestTopic };
