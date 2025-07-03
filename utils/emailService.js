import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Configure the email transporter using environment variables
// IMPORTANT: Assumes Gmail SMTP. Adjust host, port, secure for other providers.
// For Gmail, you might need to enable "Less secure app access" or use an App Password.
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com', // Default to Gmail SMTP host
  port: parseInt(process.env.EMAIL_PORT || '587', 10), // Default to 587 (TLS) or 465 (SSL)
  secure: (process.env.EMAIL_SECURE === 'true') || false, // true for 465, false for other ports (like 587 with STARTTLS)
  auth: {
    user: process.env.MAIL_USER || process.env.ADMIN_MAIL_USER,
    pass: process.env.MAIL_PASS || process.env.ADMIN_MAIL_PASS,
  },
  tls: {
    // do not fail on invalid certs (useful for development with self-signed certs)
    // rejectUnauthorized: process.env.NODE_ENV === 'development' ? false : true,
    rejectUnauthorized: false, // Simpler for now, but consider NODE_ENV check for production
  }
});

/**
 * Sends an email.
 * @param {Object} mailOptions
 * @param {string} mailOptions.to - Recipient's email address.
 * @param {string} mailOptions.subject - Email subject.
 * @param {string} [mailOptions.text] - Plain text body of the email.
 * @param {string} [mailOptions.html] - HTML body of the email.
 * @returns {Promise<void>}
 */
export const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) {
    console.error('Recipient email address (to) is required');
    return Promise.reject(new Error('Recipient email address is required'));
  }

  const senderEmail = process.env.MAIL_USER || process.env.ADMIN_MAIL_USER;
  if (!senderEmail) {
    console.error('Sender email configuration is missing');
    return Promise.reject(new Error('Sender email configuration is missing'));
  }
  
  const mailOptions = {
    from: `"Shourk" <${senderEmail}>`,
    to: to,
    subject: subject,
    text: text,
    html: html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.response);
    console.log('Sent to:', to);
    console.log('From:', senderEmail);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    console.error('Failed to send to:', to);
    console.error('Attempted from:', senderEmail);
    throw error; // Re-throw to allow handling by the caller
  }
};

// Example of how to use it (optional, for testing):
// sendEmail({
//   to: 'recipient@example.com',
//   subject: 'Test Email from Nodemailer',
//   text: 'Hello world?',
//   html: '<b>Hello world?</b>'
// }).catch(console.error); 