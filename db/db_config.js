import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables

const DB_URI = process.env.DB_URI; // Use the updated DB URI from .env

const connectDB = async () => {
  try {
    // Connect to MongoDB using the URI from .env
    await mongoose.connect(DB_URI, {
      useNewUrlParser: true,  // Use new URL parser
      useUnifiedTopology: true, // Use unified topology to handle MongoDB cluster connections
      dbName: 'AMD', // Use the AMD database
    });

    console.log('✅ MongoDB connected successfully'); // Successful connection message
  } catch (error) {
    console.error('❌ MongoDB connection error:', error); // Error message if connection fails
    process.exit(1); // Exit the process if connection fails
  }
};

export default connectDB;
