import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import connectDB from './db/db_config.js'; // Database configuration import
import expertRouter from './routes/expert.routes.js';
import userRouter from './routes/user.Route.js';
import VerifyJwt from './middleware/auth.middleware.js';
import usertoexpertsessionRouter from './routes/usertoexpertsession.routes.js';
import experttoexpertsessionRouter from './routes/experttoexpertsession.routes.js';
import { ExpertToExpertSession } from './model/experttoexpertsession.model.js';
import zoomRouter from './routes/zoom.routes.js';
import chatRoutes from './routes/chat.routes.js';
import ratingRoutes from './routes/rating.routes.js'; // <-- Import the rating routes
import { getExperts } from './controller/expert.controller.js';
import adminRoutes from './routes/admin.routes.js';
import sessionRoutes from './routes/session.routes.js';
import cancelRoutes from './routes/cancel.route.js'; // <-- Import the cancel routes
import supportRoutes from './routes/support.routes.js'; // <-- Add support routes import
import axios from 'axios'; // <-- Import axios
import freeSessionRoutes from './routes/freesession.routes.js'; // <-- Import the free session routes
import userWalletRoutes from './routes/user.wallet.routes.js'; // <-- Import the user wallet routes
import userWithdrawalRoutes from './routes/userWithdrawal.routes.js'
import expertWithdrawalRoutes from './routes/expertWithdrawal.routes.js'
import walletRoutes from './routes/wallet.routes.js'; // <-- Import the new wallet routes
import giftCardRouter from "./routes/giftcard.routes.js";
import zoomMeetingRoutes from './routes/zoomVideo.routes.js'
import { sendEmail } from './utils/emailService.js';
import expertWalletRoutesV2 from './routes/expertwallet.v2.routes.js';
// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Middleware
app.use(cors()); // Enable CORS

app.use(express.json()); // Parse incoming JSON data
// Serve uploaded files statically with proper headers
app.use("/uploads", express.static(path.join(process.cwd(), "uploads"), {
  setHeaders: (res, path) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=31536000');
  }
}));
// Connect to MongoDB (now Compass via local MongoDB URI)
connectDB();

// Default Test Route
app.get('/', (req, res) => {
  res.send('🚀 Server is running and MongoDB is connected!');
});

// Add test route before your other routes
app.get('/test-email', async (req, res) => {
  try {
    await sendEmail({
      to: 'your.test.email@gmail.com', // Replace with your email
      subject: 'Test Email from Shourk Backend',
      html: '<h1>Test Email</h1><p>If you see this, email sending is working!</p>'
    });
    res.send('Test email sent successfully!');
  } catch (error) {
    console.error('Test email failed:', error);
    res.status(500).send('Failed to send test email: ' + error.message);
  }
});

// API Routes
app.use('/api/userauth', userRouter);
app.use('/api/expertauth', expertRouter);
app.use('/api/adminauth', adminRoutes);
app.use('/api/chatbot', chatRoutes);
app.use('/api/zoom', zoomRouter);
app.use('/api/usersession', VerifyJwt, usertoexpertsessionRouter);
app.use('/api/session', VerifyJwt, experttoexpertsessionRouter, usertoexpertsessionRouter);
app.use('/api/sessions', sessionRoutes);
app.use('/api/ratings', ratingRoutes);
app.use("/api/cancelsession", cancelRoutes);
app.use("/api/support", supportRoutes); // <-- Add the support routes
app.use('/api/wallet', walletRoutes); // legacy expert wallet routes removed
app.use('/api/userwallet', userWalletRoutes)
app.use('/api/withdrawal', userWithdrawalRoutes); // <-- Add the withdrawal routes
app.use('/api/expertwithdrawal', expertWithdrawalRoutes ); // <-- Add the expert withdrawal routes
app.use('/api/freesession',freeSessionRoutes);
app.use("/api/giftcard", giftCardRouter);
app.use('/api/user-session', usertoexpertsessionRouter);
app.use('/api/zoomVideo', zoomMeetingRoutes);
app.use('/api/expertwallet', expertWalletRoutesV2);

// Add the countries route here
app.get('/api/countries', async (req, res) => {
  try {
    const response = await axios.get('https://restcountries.com/v3.1/all'); // Using Restcountries API
    const countries = response.data.map(country => country.name.common); // Extracting the country names
    res.json(countries); // Return the list of countries as a JSON response
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({ message: 'Error fetching countries' });
  }
});

// Define the Port
const PORT = process.env.PORT || 5000;

// Start the Server
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});