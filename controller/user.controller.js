import twilio from "twilio";
import jwt from "jsonwebtoken";  // Added JWT
import { User } from "../model/user.model.js";
import dotenv from "dotenv";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import Transaction from "../model/transaction.model.js";
// import { uploadToCloudinary } from "../middleware/multer.middleware.js";
import nodemailer from 'nodemailer';
import { Expert } from "../model/expert.model.js";
import {
  uploadToBytescale,
  deleteFromBytescale,
  validateFile,
  getOptimizedImageUrlWithFallback,
} from "../utils/bytescale.js";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// SMS Country configuration
const SMS_COUNTRY_CONFIG = {
  authKey: 'j8bf4snruqHE4IwY7sJv',
  baseUrl: 'https://restapi.smscountry.com/v0.1/Accounts',
  authorization: 'Basic ajhiZjRzbnJ1cUhFNEl3WTdzSnY6am94Z2Q3UjNOQ2hieGE2c0xJU0ZtR252U25vV2prYUx0dDR3QkRBZQ==',
  senderId: 'SMSCNT',
  drNotifyUrl: 'https://shourk.com'
};

// ✅ Twilio client setup
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// ✅ Helper function: Normalize phone number
const normalizePhoneNumber = (phone) => phone.replace(/[^\d]/g, "");

/// ✅ Helper function: Send OTP via SMS Country
const sendOtpToPhone = async (phone, otp) => {
  try {
    const smsBody = {
      Text: `Your OTP for login is ${otp} SMSCNT`,
      Number: phone,
      SenderId: SMS_COUNTRY_CONFIG.senderId,
      DRNotifyUrl: SMS_COUNTRY_CONFIG.drNotifyUrl,
      DRNotifyHttpMethod: "POST",
      Tool: "API"
    };

    const response = await fetch(
      `${SMS_COUNTRY_CONFIG.baseUrl}/${SMS_COUNTRY_CONFIG.authKey}/SMSes/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': SMS_COUNTRY_CONFIG.authorization
        },
        body: JSON.stringify(smsBody)
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error('SMS Country API Error:', errorData);
      throw new Error(`SMS Country API returned ${response.status}`);
    }

    const result = await response.json();
    console.log('SMS sent successfully via SMS Country:', result);
    return result;

  } catch (error) {
    console.error("Error sending OTP via SMS Country:", error);
    throw new ApiError(500, "Failed to send OTP via SMS");
  }
};

// ✅ Helper function: Send OTP via Email
const sendOtpToEmail = async (email, otp) => {
  try {
    const mailOptions = {
      from: `"Your App" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "Your OTP Code",
      html: `<p>Your OTP is: <b>${otp}</b></p>`,
    };

    await transporter.sendMail(mailOptions);
    
  } catch (error) {
    console.error("Error sending OTP via Email:", error);
    throw new ApiError(500, "Failed to send OTP via email");
  }
};

// ✅ Request OTP (Sends OTP and stores it in the database)
const requestOtp = asyncHandler(async (req, res) => {
  const { phone, email } = req.body;

  if (!phone && !email) throw new ApiError(400, "Phone number or email is required");

  // First check if this exists in Expert collection
  await checkExpertExists(email, phone);

  let otp;
  const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 minutes
  let user;

  // Generate OTP once
  otp = Math.floor(1000 + Math.random() * 9000).toString();

  if (phone) {
    // Phone-based OTP
    const normalizedPhone = normalizePhoneNumber(phone);
    user = await User.findOne({ phone: normalizedPhone });
    
  

    if (user) {
      user.otp = otp;
      user.otpExpires = otpExpires;
      await user.save();
      // Send OTP via SMS
      await sendOtpToPhone(phone, otp);
      return res.status(200).json(new ApiResponse(200, { isNewUser: false }, "OTP sent successfully via phone"));
    } else {
      user = new User({ phone: normalizedPhone, otp, otpExpires, role: "user" });
      await user.save();
      // Send OTP via SMS
      await sendOtpToPhone(phone, otp);
      return res.status(200).json(new ApiResponse(200, { isNewUser: true }, "User not found, please proceed with registration"));
    }
  }

  if (email) {
    // Email-based OTP
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      existingUser.otp = otp;
      existingUser.otpExpires = otpExpires;
      await existingUser.save();
      // Send OTP via Email
      await sendOtpToEmail(email, otp);
      return res.status(200).json(new ApiResponse(200, { isNewUser: false }, "OTP sent successfully via email"));
    } else {
      user = new User({ email, otp, otpExpires, role: "user" });
      await user.save();
      // Send OTP via Email
      await sendOtpToEmail(email, otp);
      return res.status(200).json(new ApiResponse(200, { isNewUser: true }, "User not found, please proceed with registration"));
    }
  }
});


// ✅ Verify OTP (Checks OTP and logs in/registers the user)
const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, email, otp, firstName, lastName } = req.body;
  if (!phone && !email || !otp) throw new ApiError(400, "Phone or Email and OTP are required");

  let user;
  const normalizedPhone = phone ? normalizePhoneNumber(phone) : null;

  if (phone) {
    user = await User.findOne({ phone: normalizedPhone });
  } else if (email) {
    user = await User.findOne({ email });
  }

  if (!user || user.otp !== otp || new Date() > user.otpExpires) {
    throw new ApiError(400, "Invalid or expired OTP");
  }

  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();

  // If the user doesn't exist or has incomplete information, proceed with registration
  if (!user.firstName || !user.lastName) {
    user.firstName = firstName;
    user.lastName = lastName;
    user.email = email;
    await user.save();

    // Do not generate the token here for new users
    return res.status(200).json(new ApiResponse(200, { isNewUser: true }, "OTP verified, registration completed"));
  }

  // Generate a token only for existing users (not for new users)
  const token = jwt.sign(
    { _id: user._id, phone: user.phone, email: user.email, role: "user" },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  return res.status(200).json(new ApiResponse(200, { isNewUser: false, token }, "OTP verified, login successful"));
});

const checkExpertExists = async (email, phone) => {
  const normalizedPhone = phone ? normalizePhoneNumber(phone) : null;
  console.log("Checking for email:", email);
  console.log("Checking for phone:", phone);
  console.log("Normalized phone:", normalizedPhone);

  // Build query conditions more carefully
  const queryConditions = [];
  
  if (email) {
    queryConditions.push({ email });
  }
  
  if (normalizedPhone) {
    queryConditions.push({ phone: normalizedPhone });
  }

  // Only query if we have conditions to check
  if (queryConditions.length === 0) {
    return; // Nothing to check
  }

  const expert = await Expert.findOne({
    $or: queryConditions
  });

  console.log("Found expert:", expert);

  if (expert) {
    // Check which field actually matches
    if (email && expert.email === email) {
      throw new ApiError(400, `This email is registered as an expert. Please use a different email.`);
    } else if (normalizedPhone && expert.phone === normalizedPhone) {
      throw new ApiError(400, `This phone is registered as an expert. Please use a different phone.`);
    }
    // If we reach here, there might be a logic error
    console.error("Expert found but no matching field identified:", {
      inputEmail: email,
      inputPhone: normalizedPhone,
      expertEmail: expert.email,
      expertPhone: expert.phone
    });
  }

  // If no expert found, function completes without error
};



// ✅ Register User (Creates a user after OTP verification)
const registerUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone } = req.body;

  if (!firstName || !lastName || !email) {
    throw new ApiError(400, "First name, last name, and email are required");
  }

  const normalizedPhone = phone ? normalizePhoneNumber(phone) : null;

  // Check if a user already exists with the same email or phone
  const existingUser = await User.findOne({
    $or: [
      { email },
      ...(normalizedPhone ? [{ phone: normalizedPhone }] : [])
    ]
  });

  
  let user;

  if (existingUser) {
    // Update existing user
    existingUser.firstName = firstName;
    existingUser.lastName = lastName;
   
    if (normalizedPhone) existingUser.phone = normalizedPhone;

    user = await existingUser.save();
  } else {
    // Create new user
    user = await User.create({
      firstName,
      lastName,
      email,
      phone: normalizedPhone
    });
  }

  return res.status(201).json(
    new ApiResponse(201, { message: "User registered successfully" })
  );
});


const refreshToken = asyncHandler(async (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user = await User.findById(decoded._id);
    
    const newToken = jwt.sign(
      { _id: user._id, email: user.email, role: "user" },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({ newToken });
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
});

const getUsers = asyncHandler(async (req, res) => {
  try {
    const users = await User.find();  // Fetch all users from the database
    res.status(200).json(new ApiResponse(200, users, "Users retrieved successfully"));
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching users.",
      error: error.message,
    });
  }
});

// ✅ Get User Profile (Fetch user details by ID)
const getUserProfile = asyncHandler(async (req, res) => {
  const { id } = req.params; // Get user ID from URL parameters
  let user = await User.findById(id); // Fetch user details from database

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Send user data as response
  return res.status(200).json(
    new ApiResponse(200, { user }, "User profile fetched successfully")
  );
});

const getUserById = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid user ID format");
  }

  const objectId = new mongoose.Types.ObjectId(userId);
  const user = await User.findById(objectId);
  if (!user) throw new ApiError(404, "User not found");

  res.status(200).json(new ApiResponse(200, user, "User retrieved"));
});

const uploadPhoto = asyncHandler(async (req, res) => {
  try {
    let photoUrl = null;
    const userId = req.params.id;

    if (req.files && req.files.photoFile && req.files.photoFile[0]) {
      const photoFile = req.files.photoFile[0];
      // Validate file
      const validation = validateFile(photoFile);
      if (!validation.isValid) {
        return res.status(400).json({ success: false, error: validation.error });
      }
      // Find user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      // Delete old photo from Bytescale if exists
      if (user.photoFile && user.photoFile.includes("/raw/")) {
        try {
          const urlParts = user.photoFile.split("/raw/");
          if (urlParts.length > 1) {
            const filePath = "/" + urlParts[1];
            await deleteFromBytescale(filePath);
          }
        } catch (deleteError) {
          console.error("Error deleting old photo:", deleteError);
        }
      }
      // Upload new photo to Bytescale
      const photoResult = await uploadToBytescale(
        photoFile.buffer,
        photoFile.originalname,
        photoFile.mimetype,
        "users/photos"
      );
      photoUrl = photoResult.fileUrl;
      user.photoFile = photoUrl;
      await user.save();
      const optimizedUrl = getOptimizedImageUrlWithFallback(photoUrl, { width: 400, height: 400 });
      return res.status(200).json(new ApiResponse(200, { ...user.toObject(), photoFile: optimizedUrl }, "Photo uploaded successfully"));
    } else {
      return res.status(400).json({ success: false, message: "No image file provided" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});



// this is comment because at present admin thing that it is illogical to update phone number by admin
// const updateuserphone = asyncHandler(async (req, res) => {
//   const { phone, email } = req.body;
//   const userId = req.params.id;

//   // Check if phone number is provided
//   if (!phone) {
//     throw new ApiError(400, "Phone number is required");
//   }

//   // Check if email exists in DB
//   const user = await User.findOne({ email });

//   if (!user) {
//     throw new ApiError(404, "User with this email does not exist");
//   }

//   // Update the phone number
//   user.phone = phone;
//   await user.save();

//   res.status(200).json({
//     success: true,
//     message: "Phone number updated successfully",
//     user,
//   });
// });
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, email } = req.body;

    // Optional: Validate input data
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide all required fields' 
      });
    }

    // Find the user model in your database
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Handle profile photo update if file is sent
    if (req.files && req.files.photoFile && req.files.photoFile[0]) {
      const photoFile = req.files.photoFile[0];
      // Validate file
      const validation = validateFile(photoFile);
      if (!validation.isValid) {
        return res.status(400).json({ success: false, message: validation.error });
      }
      // Delete old photo from Bytescale if exists
      if (user.photoFile && user.photoFile.includes("/raw/")) {
        try {
          const urlParts = user.photoFile.split("/raw/");
          if (urlParts.length > 1) {
            const filePath = "/" + urlParts[1];
            await deleteFromBytescale(filePath);
          }
        } catch (deleteError) {
          console.error("Error deleting old photo:", deleteError);
        }
      }
      // Upload new photo to Bytescale
      const photoResult = await uploadToBytescale(
        photoFile.buffer,
        photoFile.originalname,
        photoFile.mimetype,
        "users/photos"
      );
      user.photoFile = photoResult.fileUrl;
    }

    // Update user fields
    user.firstName = firstName;
    user.lastName = lastName;
    user.phone = phone;
    user.email = email;

    // Save the updated user
    const updatedUser = await user.save();

    // Return optimized photo URL if exists
    const optimizedPhotoUrl = updatedUser.photoFile
      ? getOptimizedImageUrlWithFallback(updatedUser.photoFile, { width: 400, height: 400 })
      : null;

    // Return success response
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        phone: updatedUser.phone,
        email: updatedUser.email,
        photoFile: optimizedPhotoUrl
      }
    });

  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while updating profile',
      error: error.message 
    });
  }
};



const deleteUser = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  await User.findByIdAndDelete(userId);

  res.status(200).json({
    success: true,
    message: "User deleted successfully",
  });
});

const getUserTransactions = asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "UserID is required",
    });
  }

  const transaction = await Transaction.find({ userId: userId })
  .populate('userId', 'firstName lastName email phone')
  
  res.status(200).json(
    new ApiResponse(200, transaction, "User transactions retrieved successfully")
  );

});



export { requestOtp, verifyOtp, registerUser, getUserProfile, getUserById, uploadPhoto, getUsers ,deleteUser, refreshToken, updateUser, getUserTransactions};
