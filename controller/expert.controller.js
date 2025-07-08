import { Expert } from '../model/expert.model.js';
import twilio from 'twilio';
import dotenv from 'dotenv';
import jwt from "jsonwebtoken";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { upload } from '../middleware/multer.middleware.js';
import { ExpertAvailability } from '../model/expertavailability.model.js';
import mongoose from "mongoose";
// import cloudinary from 'cloudinary';
import streamifier from 'streamifier';
import nodemailer from 'nodemailer';
import { User } from '../model/user.model.js';
import { ExpertToExpertSession } from '../model/experttoexpertsession.model.js';
import { UserToExpertSession } from '../model/usertoexpertsession.model.js';
import Transaction from '../model/transaction.model.js';
import { uploadToBytescale, deleteFromBytescale, getOptimizedImageUrlWithFallback, validateFile } from '../utils/bytescale.js';
dotenv.config();

// LinkedIn URL validation function
const validateLinkedInLink = (link) => {
  const linkedinPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/.*$/;
  return linkedinPattern.test(link);
};

const transporterForOtp = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const transporterForAdminApproval = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

const normalizePhoneForSMS = (phone) => {
  // Remove all non-digits
  let   normalized = phone.replace(/[^\d]/g, "");
  
  // If it doesn't start with country code, add India's country code
  if (!normalized.startsWith('91') && normalized.length === 10) {
    normalized = '91' + normalized;
  }
  
  // Ensure it starts with 91 for India
  if (!normalized.startsWith('91')) {
    throw new Error('Invalid Indian phone number format');
  }
  
  return normalized;
};

// SMS Country configuration
const SMS_COUNTRY_CONFIG = {
  authKey: 'j8bf4snruqHE4IwY7sJv',
  baseUrl: 'https://restapi.smscountry.com/v0.1/Accounts',
  authorization: 'Basic ajhiZjRzbnJ1cUhFNEl3WTdzSnY6am94Z2Q3UjNOQ2hieGE2c0xJU0ZtR252U25vV2prYUx0dDR3QkRBZQ==',
  senderId: 'SMSCNT',
  drNotifyUrl: 'https://shourk.com',
  // Add retry configuration
  maxRetries: 3,
  retryDelay: 1000
};

// Helper functions
const normalizePhoneNumber = (phone) => phone.replace(/[^\d]/g, "");
/// ✅ Helper function: Send OTP via SMS Country
// Enhanced SMS sending function with better error handling
const sendOtpToPhone = async (phone, otp, retryCount = 0) => {
  try {
    // Normalize phone number for SMS Country
    const normalizedPhone = normalizePhoneForSMS(phone);
    console.log(`Sending SMS to normalized number: ${normalizedPhone}`);
    
       const smsBody = {
      Text: `User Admin login OTP is ${otp} - SMSCNT`,
      Number: normalizedPhone, // Use the properly normalized number
      SenderId: SMS_COUNTRY_CONFIG.senderId,
      DRNotifyUrl: SMS_COUNTRY_CONFIG.drNotifyUrl,
      DRNotifyHttpMethod: "POST",
      Tool: "API",
      TemplateId: "1407159731311206515" // Use your registered template ID
    };

    console.log('SMS Request Body:', JSON.stringify(smsBody, null, 2));

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

    // Log response details
    console.log(`SMS Country Response Status: ${response.status}`);
    console.log(`SMS Country Response Headers:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorData = await response.text();
      console.error('SMS Country API Error Response:', errorData);
      
      // Try to parse error if it's JSON
      try {
        const errorJson = JSON.parse(errorData);
        console.error('Parsed Error:', errorJson);
      } catch (e) {
        console.error('Raw Error Text:', errorData);
      }
      
      throw new Error(`SMS Country API returned ${response.status}: ${errorData}`);
    }

    const result = await response.json();
    console.log('SMS sent successfully via SMS Country:', result);
    
    // Check if the response indicates success
    if (result.Success === 'True' || result.Success === true) {
      return result;
    } else {
      throw new Error(`SMS Country returned unsuccessful response: ${JSON.stringify(result)}`);
    }

  } catch (error) {
    console.error(`Error sending OTP via SMS Country (attempt ${retryCount + 1}):`, error);
    
    // Retry logic for network errors
    if (retryCount < SMS_COUNTRY_CONFIG.maxRetries && 
        (error.message.includes('fetch') || error.message.includes('network'))) {
      console.log(`Retrying SMS send in ${SMS_COUNTRY_CONFIG.retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, SMS_COUNTRY_CONFIG.retryDelay));
      return sendOtpToPhone(phone, otp, retryCount + 1);
    }
    
    throw new ApiError(500, `Failed to send OTP via SMS: ${error.message}`);
  }
};
const checkUserExists = async (email, phone) => {
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

  const user = await User.findOne({
    $or: queryConditions
  });

  console.log("Found user:", user);

  if (user) {
    // Check which field actually matches
    if (email && user.email === email) {
      throw new ApiError(400, `This email is registered as an user. Please use a different email.`);
    } else if (normalizedPhone && user.phone === normalizedPhone) {
      throw new ApiError(400, `This phone is registered as an user. Please use a different phone.`);
    }
    // If we reach here, there might be a logic error
    console.error("User found but no matching field identified:", {
      inputEmail: email,
      inputPhone: normalizedPhone,
      userEmail: user.email,
      userPhone: user.phone
    });
  }

  // If no expert found, function completes without error
};

const validatePhoneNumber = (phone) => {
  if (!phone) return false;
  
  // Remove all non-digits
  const digitsOnly = phone.replace(/[^\d]/g, "");
  
  // Check if it's a valid Indian mobile number
  // Indian mobile numbers are 10 digits starting with 6,7,8,9
  // Or 12 digits starting with 91 followed by valid mobile number
  if (digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly)) {
    return true;
  }
  
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91') && /^91[6-9]/.test(digitsOnly)) {
    return true;
  }
  
  return false;
};
const requestOtp = asyncHandler(async (req, res) => {
  const { phone, email } = req.body;

  // Check if either phone or email is provided
  if (!phone && !email) throw new ApiError(400, "Phone or email is required");

  // Validate phone number format if provided
  if (phone && !validatePhoneNumber(phone)) {
    throw new ApiError(400, "Please enter a valid Indian mobile number");
  }

  await checkUserExists(email, phone);

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 minutes

  let expert = null;
  let isNewExpert = true;

  // Handle phone login
  if (phone) {
    const normalizedPhone = normalizePhoneNumber(phone); // For database storage
    console.log(`Processing phone login for: ${phone} -> ${normalizedPhone}`);

    // Check if expert exists with this phone
    expert = await Expert.findOne({ phone: normalizedPhone });
    isNewExpert = !expert?.email; // Check if email is not set, meaning it's a new expert

    if (expert) {
      // Update existing expert's OTP
      expert.otp = otp;
      expert.otpExpires = otpExpires;
      console.log(`Updated OTP for existing expert: ${expert._id}`);
    } else {
      // Create a new expert if none exists
      expert = new Expert({
        phone: normalizedPhone,
        otp,
        otpExpires,
        role: "expert",
        status: "Pending"
      });
      console.log(`Created new expert with phone: ${normalizedPhone}`);
    }

    // Send OTP with enhanced error handling
    try {
      await sendOtpToPhone(phone, otp);
      console.log(`OTP sent successfully to ${phone}`);
    } catch (smsError) {
      console.error('Failed to send SMS:', smsError);
      // Don't save the expert if SMS fails
      throw new ApiError(500, "Failed to send OTP. Please try again or use email login.");
    }

  }
  // Handle email login
  else if (email) {
    // Check if expert exists with this email
    expert = await Expert.findOne({ email });
    isNewExpert = !expert?.phone; // Check if phone is not set, meaning it's a new expert

    if (expert) {
      // Update existing expert's OTP
      expert.otp = otp;
      expert.otpExpires = otpExpires;
    } else {
      // Create a new expert if none exists
      expert = new Expert({
        email,
        otp,
        otpExpires,
        role: "expert",
        status: "Pending"
      });
    }

    // Send OTP via email for email login
    const mailOptions = {
      from: `"Shourk Support" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "Your OTP Code",
      html: `<p>Your verification code is: <b>${otp}</b></p>
             <p>This OTP is valid for 5 minutes.</p>`,
    };

    try {
      await transporterForOtp.sendMail(mailOptions);
      console.log(`OTP email sent successfully to ${email}`);
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
      throw new ApiError(500, "Failed to send OTP email. Please try again.");
    }
  }

  // Save the expert data to the database only after successful OTP sending
  await expert.save();
  console.log(`Expert saved successfully: ${expert._id}`);

  // Respond with success message
  res.status(200).json(new ApiResponse(200, { isNewExpert }, "OTP sent successfully"));
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, email, otp } = req.body;
  if ((!phone && !email) || !otp) {
    throw new ApiError(400, "Phone or Email and OTP are required");
  }

  let expert;

  if (phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    expert = await Expert.findOne({ phone: normalizedPhone });
  } else if (email) {
    expert = await Expert.findOne({ email });
  }

  if (!expert || expert.otp !== otp || new Date() > expert.otpExpires) {
    throw new ApiError(400, "Invalid or expired OTP");
  }

  // Clear OTP fields
  expert.otp = undefined;
  expert.otpExpires = undefined;
  await expert.save();

  // Check registration completeness
  if (expert.firstName && expert.lastName && expert.email) {
    // Add status to token payload
    const tokenPayload = {
      _id: expert._id,
      role: "expert",
      status: expert.status,
      ...(phone && { phone: expert.phone }),
      ...(email && { email: expert.email }),
    };

    // Different expiration for pending vs approved
    const tokenExpiration = expert.status === "Pending" ? "24h" : "7d";

    const token = jwt.sign(
      tokenPayload,
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: tokenExpiration }
    );

    return res.status(200).json(
      new ApiResponse(
        200, 
        {
          isNewExpert: false,
          token,
          status: expert.status,
          redirectTo: expert.status === "Pending" 
            ? "/reviewingexpertpanel/expertpanelprofile" 
            : "/expertpanel/expertpanelprofile"
        },
        expert.status === "Pending" 
          ? "OTP verified - account pending approval" 
          : "OTP verified - login successful"
      )
    );
  }

  // Handle incomplete registration
  return res.status(200).json(
    new ApiResponse(
      200, 
      { isNewExpert: true }, 
      "OTP verified - complete registration"
    )
  );
});


// Merged registerExpert Controller
// const registerExpert = asyncHandler(async (req, res) => {
//   const { email, firstName, lastName, gender, phone, socialLink, areaOfExpertise, experience, category } = req.body;
//   const files = req.files;

//   // Validate required fields (excluding phone)
//   if (!firstName || !lastName || !email || !gender) {
//     throw new ApiError(400, 'All fields are required');
//   }

//   // Validate profile fields (optional, but must be filled in case of profile completion)
//   if (!socialLink || !areaOfExpertise || !experience) {
//     throw new ApiError(400, 'Social link, area of expertise, and experience are required');
//   }

//   // Normalize phone number and find expert by phone
//   const normalizedPhone = phone.replace(/[^\d]/g, "");
//   let expert = await Expert.findOne({ phone: normalizedPhone });

//   // If expert exists but isn't fully registered (no email, firstName, or lastName)
//   if (expert && !expert.email) {
//     expert.firstName = firstName;
//     expert.lastName = lastName;
//     expert.email = email;
//     expert.gender = gender;

//     expert.socialLink = socialLink;
//     expert.areaOfExpertise = areaOfExpertise;
//     expert.experience = experience;
//     expert.category = category;  // Save category field

//     // Save the certification and photo files if available
//     if (files?.certification?.[0]) {
//       expert.certificationFile = files.certification[0].path;
//     }
//     if (files?.photo?.[0]) {
//       expert.photoFile = files.photo[0].path;
//     }

//     await expert.save();

//     return res.status(201).json(new ApiResponse(201, expert, 'Expert registered and profile completed successfully.'));
//   }

//   // If expert does not exist, create a new record
//   if (!expert) {
//     expert = new Expert({
//       phone: normalizedPhone,
//       firstName,
//       lastName,
//       email,
//       gender,
//       socialLink,
//       areaOfExpertise,
//       experience,
//       category,  // Save category field
//       role: 'expert',
//     });

//     // Save the certification and photo files if available
//     // if (files?.certification?.[0]) {
//     //   expert.certificationFile = files.certification[0].path;
//     // }
//     // if (files?.photo?.[0]) {
//     //   expert.photoFile = files.photo[0].path;
//     // }

//     await expert.save();
//     return res.status(201).json(new ApiResponse(201, expert, 'Expert registered successfully'));
//   }

//   // If expert already has email or full registration data
//   throw new ApiError(400, 'Expert already registered');
// });


// // Configure Cloudinary using your credentials (ideally use environment variables)
// cloudinary.v2.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME, //|| 'dctmzawgj',
//   api_key: process.env.CLOUDINARY_API_KEY,// || '517938482585331',
//   api_secret: process.env.CLOUDINARY_API_SECRET,// || 'i6XCN0_E4JGeoTSJQU5uK0c9odw'
// });

// // Helper function to upload a file buffer to Cloudinary
// const uploadToCloudinary = (fileBuffer, folder, resource_type = 'image') => {
//   return new Promise((resolve, reject) => {
//     // Check the file type (MIME type)
//     if (resource_type === 'image') {
//       const mimeType = fileBuffer.mimetype;
//       if (!['image/jpeg', 'image/png', 'image/jpg'].includes(mimeType)) {
//         return reject(new Error("Invalid image file"));
//       }
//     }

//     const uploadStream = cloudinary.v2.uploader.upload_stream(
//       {
//         folder, resource_type: 'auto',
//         transformation: [
//           { width: 800, height: 800, crop: 'limit' }]
//       },
//       (error, result) => {
//         if (error) return reject(error);
//         resolve(result);
//       }
//     );
//     streamifier.createReadStream(fileBuffer.buffer).pipe(uploadStream);
//   });
// };


// Controller to handle expert registration with file uploads
// LinkedIn URL validation function
// const validateLinkedInLink = (link) => {
//   const linkedinPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/.*$/;
//   return linkedinPattern.test(link);
// };

// 🔥 UPDATED: Expert registration with Bytescale integration
const registerExpert = async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      gender,
      phone,
      socialLink,
      areaOfExpertise,
      specificArea,
      experience,
      price,
    } = req.body;

    if (socialLink && !validateLinkedInLink(socialLink)) {
      return res
        .status(400)
        .json({ success: false, error: "Please enter a valid LinkedIn link." });
    }

    let photoUrl = null;
    let certificationUrl = null;

    if (req.files?.photoFile?.[0]) {
      const photoFile = req.files.photoFile[0];
      const validation = validateFile(photoFile);
      if (!validation.isValid)
        return res
          .status(400)
          .json({ success: false, error: validation.error });

      const photoResult = await uploadToBytescale(
        photoFile.buffer,
        photoFile.originalname,
        photoFile.mimetype,
        "experts/photos"
      );
      photoUrl = photoResult.fileUrl;
    }

    if (req.files?.certificationFile?.[0]) {
      const certFile = req.files.certificationFile[0];
      const validation = validateFile(certFile);
      if (!validation.isValid)
        return res
          .status(400)
          .json({ success: false, error: validation.error });

      const certResult = await uploadToBytescale(
        certFile.buffer,
        certFile.originalname,
        certFile.mimetype,
        "experts/certifications"
      );
      certificationUrl = certResult.fileUrl;
    }

    const missingFields = [];
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!email) missingFields.push("email");
    if (!gender) missingFields.push("gender");
    if (!socialLink) missingFields.push("socialLink");
    if (!areaOfExpertise) missingFields.push("areaOfExpertise");
    if (!experience) missingFields.push("experience");
    if (missingFields.length > 0)
      return res
        .status(400)
        .json({ success: false, error: "Missing fields", missingFields });

    const normalizedPhone = phone?.replace(/[^\d]/g, "") || "";
    let expert = await Expert.findOne({
      $or: [{ phone: normalizedPhone }, { email: email.toLowerCase() }],
    });

    if (expert) {
  // Expert exists — update only if missing critical info
  const needsUpdate = !expert.firstName || !expert.lastName || !expert.areaOfExpertise;

  if (needsUpdate) {
    Object.assign(expert, {
      firstName, lastName, email, gender,
      socialLink, areaOfExpertise: areaOfExpertise === "Others" ? specificArea : areaOfExpertise,
      experience, price, photoFile: photoUrl,
      certificationFile: certificationUrl, status: "Pending"
    });
    await expert.save();
  } else {
    return res.status(409).json({ success: false, error: "This expert is already registered." });
  }
} else {
  expert = new Expert({
    email: email.toLowerCase(), firstName, lastName, gender,
    phone: normalizedPhone, socialLink,
    areaOfExpertise: areaOfExpertise === "Others" ? specificArea : areaOfExpertise,
    experience, price, photoFile: photoUrl,
    certificationFile: certificationUrl, role: "expert", status: "Pending"
  });
  await expert.save();
}


    await transporterForAdminApproval.sendMail({
      from: `"Shourk Support" <${process.env.MAIL_USER}>`,
      to: expert.email,
      subject: "Registration Submitted Successfully",
      html: `<p>Dear ${expert.firstName},</p><p>Your registration has been submitted. Please wait for admin approval.</p>`,
    });

    res
      .status(201)
      .json({
        success: true,
        message: "Expert registered successfully",
        expert,
      });
  } catch (error) {
    console.error("Registration Error:", error);
    res
      .status(500)
      .json({
        success: false,
        error: "Registration failed",
        systemError: error.message,
      });
  }
};

// 🔥 UPDATED: Profile picture update with Bytescale
const updateExpertProfilePicture = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if a file was uploaded
    if (!req.files || !req.files.photoFile || !req.files.photoFile[0]) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    // Find the expert
    const expert = await Expert.findById(id);

    if (!expert) {
      return res.status(404).json({
        success: false,
        message: "Expert not found",
      });
    }

    const photoFile = req.files.photoFile[0];

    // Validate file using your utility
    const validation = validateFile(photoFile);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.error,
      });
    }

    // 🔥 NEW: Delete old photo from Bytescale if exists
    if (expert.photoFile) {
      try {
        // Extract file path from URL for deletion
        // For your Bytescale setup: https://upcdn.io/ACCOUNT_ID/raw/path
        const urlParts = expert.photoFile.split("/raw/");
        if (urlParts.length > 1) {
          const filePath = "/" + urlParts[1]; // <-- This ensures the leading slash
          await deleteFromBytescale(filePath);
        }
      } catch (deleteError) {
        console.error("Error deleting old photo:", deleteError);
        // Continue with upload even if deletion fails
      }
    }

    // Upload new photo to Bytescale
    try {
      const photoResult = await uploadToBytescale(
        photoFile.buffer,
        photoFile.originalname,
        photoFile.mimetype,
        "experts/photos"
      );

      // Update expert's photo URL
      expert.photoFile = photoResult.fileUrl;
      await expert.save();

      // Return optimized URL for immediate use
      const optimizedUrl = getOptimizedImageUrlWithFallback(
        photoResult.fileUrl,
        {
          width: 400,
          height: 400,
        }
      );

      res.status(200).json({
        success: true,
        message: "Profile picture updated successfully",
        data: {
          photoFile: optimizedUrl,
          originalUrl: photoResult.fileUrl,
        },
      });
    } catch (uploadError) {
      console.error("Error updating profile picture:", uploadError);
      res.status(500).json({
        success: false,
        message: "Upload failed",
        error: uploadError.message,
      });
    }
  } catch (error) {
    console.error("Error updating profile picture:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating profile picture",
      error: error.message,
    });
  }
};

// 🔥 UPDATED: Profile update with Bytescale integration
const updateExpertProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, email } = req.body;

    // Find the expert
    const expert = await Expert.findById(id);

    if (!expert) {
      return res.status(404).json({
        success: false,
        message: "Expert not found",
      });
    }

    // Check if this is a file upload request
    if (req.files && req.files.photoFile && req.files.photoFile[0]) {
      const photoFile = req.files.photoFile[0];

      // Validate file using your utility
      const validation = validateFile(photoFile);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: validation.error,
        });
      }

      // Delete old photo if exists
      if (expert.photoFile) {
        try {
          const urlParts = expert.photoFile.split("/raw/");
          if (urlParts.length > 1) {
            const filePath = "/" + urlParts[1]; // <-- This ensures the leading slash
            await deleteFromBytescale(filePath);
          }
        } catch (deleteError) {
          console.error("Error deleting old photo:", deleteError);
        }
      }

      // Upload new photo to Bytescale
      try {
        const photoResult = await uploadToBytescale(
          photoFile.buffer,
          photoFile.originalname,
          photoFile.mimetype,
          "experts/photos"
        );

        expert.photoFile = photoResult.fileUrl;
        await expert.save();

        const optimizedUrl = getOptimizedImageUrlWithFallback(
          photoResult.fileUrl,
          {
            width: 400,
            height: 400,
          }
        );

        return res.status(200).json({
          success: true,
          message: "Profile picture updated successfully",
          data: {
            photoFile: optimizedUrl,
          },
        });
      } catch (uploadError) {
        return res.status(500).json({
          success: false,
          message: "Photo upload failed",
          error: uploadError.message,
        });
      }
    }

    // Handle regular profile updates
    if (!firstName || !lastName || !email) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    // Update expert fields
    expert.firstName = firstName;
    expert.lastName = lastName;
    expert.phone = phone;
    expert.email = email;

    // Save the updated expert
    const updatedExpertProfile = await expert.save();

    // Return optimized photo URL if exists
    const optimizedPhotoUrl = updatedExpertProfile.photoFile
      ? getOptimizedImageUrlWithFallback(updatedExpertProfile.photoFile, {
          width: 400,
          height: 400,
        })
      : null;

    // Return success response
    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        firstName: updatedExpertProfile.firstName,
        lastName: updatedExpertProfile.lastName,
        phone: updatedExpertProfile.phone,
        email: updatedExpertProfile.email,
        photoFile: optimizedPhotoUrl,
      },
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating profile",
      error: error.message,
    });
  }
};

// Add this to your expertauth.controller.js file
const refreshToken = asyncHandler(async (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const expert = await Expert.findById(decoded._id);
    
    if (!expert) {
      return res.status(404).json({ message: "Expert not found" });
    }
    
    const newToken = jwt.sign(
      { _id: expert._id, email: expert.email, role: "expert" },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({ newToken });
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
});


const logoutExpert = asyncHandler(async (req, res) => {
  await Expert.findByIdAndUpdate(
    req.expert._id,
    {
      $unset: {
        token: 1,
      },
    },
    {
      new: true,
    }
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("token", options)
    .json(new ApiResponse(200, {}, "User logged out"));
});



const getExperts = asyncHandler(async (req, res) => {
  try {
    const experts = await Expert.find(); // Fetch all experts
    res.status(200).json(new ApiResponse(200, experts, "Experts retrieved"));
  } catch (error) {
    console.error("Error fetching experts:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching experts.",
      error: error.message,
    });
  }
});


const getExpertById = asyncHandler(async (req, res) => {
  const expertId = req.params.id;

  // Validate ID format
  if (!mongoose.Types.ObjectId.isValid(expertId)) {
    throw new ApiError(400, "Invalid expert ID format");
  }

  const expert = await Expert.findById(expertId);
  if (!expert) throw new ApiError(404, "Expert not found");

  res.status(200).json(new ApiResponse(200, expert, "Expert retrieved"));
});


// Fetch experts by area of expertise
const getExpertsByArea = asyncHandler(async (req, res) => {
  const { area } = req.params;

  const experts = await Expert.find({ areaOfExpertise: area });

  if (experts.length === 0) {
    return res.status(404).json(new ApiResponse(404, [], "No experts found for this area"));
  }

  res.status(200).json(new ApiResponse(200, experts, "Experts fetched successfully"));
});



// Controller for updating the charity settings
const updateExpertCharity = async (req, res) => {
  try {
    // Extract the token from the Authorization header (Bearer <token>)
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    // Decode the token to get the expert _id
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    if (!decoded || !decoded._id) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    // Now we have the expert's MongoDB ObjectId (_id) from the decoded token
    const expertId = decoded._id;

    // Find the expert by MongoDB ObjectId
    const expert = await Expert.findById(expertId);

    if (!expert) {
      return res.status(404).json({
        success: false,
        message: "Expert not found",
      });
    }

    // Proceed to update the charity information
    const { charityEnabled, charityPercentage, charityName } = req.body;

    // Update the charity settings for this expert
    expert.charityEnabled = charityEnabled;
    expert.charityPercentage = charityPercentage;
    expert.charityName = charityName;

    // Save the updated expert data
    await expert.save();

    res.status(200).json({
      success: true,
      message: "Charity settings updated successfully",
      data: expert,
    });
  } catch (error) {
    console.error("Error updating charity settings:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while updating charity settings.",
      error: error.message,
    });
  }
};

const updateExpertPrice = async (req, res) => {
  try {
    const { price } = req.body;
    const expertId = req.headers.expertid;

    if (!expertId) {
      return res.status(400).json({
        success: false,
        message: "Expert ID is required",
      });
    }

    const expert = await Expert.findByIdAndUpdate(
      expertId,
      { price },
      { new: true }
    );

    if (!expert) {
      return res.status(404).json({
        success: false,
        message: "Expert not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Price updated successfully",
      data: { price: expert.price },
    });
  } catch (error) {
    console.error("Error updating expert price:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const calculateAge = (dob) => {
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const month = today.getMonth();
  if (
    month < birthDate.getMonth() ||
    (month === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
};

const updateExpert= async (req, res) => {
  try {
    const expertId = req.body._id || req.params.id;

    if (!expertId) {
      return res.status(400).json({ message: "Expert ID is required" });
    }

    const expert = await Expert.findById(expertId);

    if (!expert) {
      return res.status(404).json({
        success: false,
        message: "Expert not found",
      });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      areaOfExpertise,
      dateOfBirth,
    } = req.body;

    if (firstName) expert.firstName = firstName;
    if (lastName) expert.lastName = lastName;
    if (email) expert.email = email;
    if (phone) expert.phone = phone;
    if (areaOfExpertise) expert.areaOfExpertise = areaOfExpertise;
    if (dateOfBirth) {
      expert.dateOfBirth = dateOfBirth;
      expert.age = calculateAge(dateOfBirth);
    }

    await expert.save();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: expert,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while updating profile.",
      error: error.message,
    });
  }
};



// Add this new controller function for updating profile picture specifically
// const updateExpertProfilePicture = async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     // Check if a file was uploaded
//     if (!req.files || !req.files.photoFile || !req.files.photoFile[0]) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'No image file provided' 
//       });
//     }

//     // Find the expert
//     const expert = await Expert.findById(id);
    
//     if (!expert) {
//       return res.status(404).json({
//         success: false,
//         message: 'Expert not found'
//       });
//     }

//     // Upload the new photo to Cloudinary
//     const photoFile = req.files.photoFile[0];
//     const photoResult = await uploadToCloudinary(photoFile, 'experts/photos');
    
//     // Update the expert's photo URL
//     expert.photoFile = photoResult.secure_url;
//     await expert.save();

//     // Return success response
//     res.status(200).json({
//       success: true,
//       message: 'Profile picture updated successfully',
//       data: {
//         photoFile: expert.photoFile
//       }
//     });

//   } catch (error) {
//     console.error('Error updating profile picture:', error);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Server error while updating profile picture',
//       error: error.message 
//     });
//   }
// };

// const updateExpertProfile = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { firstName, lastName, phone, email } = req.body;

//     // Find the expert
//     const expert = await Expert.findById(id);
    
//     if (!expert) {
//       return res.status(404).json({
//         success: false,
//         message: 'Expert not found'
//       });
//     }

//     // Check if this is a file upload request
//     if (req.files && req.files.photoFile && req.files.photoFile[0]) {
//       // Handle profile picture upload
//       const photoFile = req.files.photoFile[0];
//       const photoResult = await uploadToCloudinary(photoFile, 'experts/photos');
//       expert.photoFile = photoResult.secure_url;
      
//       // Save and return immediately for image upload
//       await expert.save();
//       return res.status(200).json({
//         success: true,
//         message: 'Profile picture updated successfully',
//         data: {
//           photoFile: expert.photoFile
//         }
//       });
//     }

//     // Handle regular profile updates
//     if (!firstName || !lastName || !email) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Please provide all required fields' 
//       });
//     }

//     // Update expert fields
//     expert.firstName = firstName;
//     expert.lastName = lastName;
//     expert.phone = phone;
//     expert.email = email;

//     // Save the updated expert
//     const updatedExpertProfile = await expert.save();

//     // Return success response
//     res.status(200).json({
//       success: true,
//       message: 'Profile updated successfully',
//       data: {
//         firstName: updatedExpertProfile.firstName,
//         lastName: updatedExpertProfile.lastName,
//         phone: updatedExpertProfile.phone,
//         email: updatedExpertProfile.email,
//         photoFile: updatedExpertProfile.photoFile
//       }
//     });

//   } catch (error) {
//     console.error('Error updating user profile:', error);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Server error while updating profile',
//       error: error.message 
//     });
//   }
// };




const updateExpertExperience = async (req, res) => {
  try {
    const expertId = req.body._id || req.params.id;

    if (!expertId) {
      return res.status(400).json({ message: "Expert ID is required" });
    }

    const expert = await Expert.findById(expertId);

    if (!expert) {
      return res.status(404).json({
        success: false,
        message: "Expert not found",
      });
    }

    const { aboutMe, advice } = req.body;

    // Map aboutMe to experience field in the database
    if (aboutMe !== undefined) expert.experience = aboutMe;

    // Handle advice array updates
    if (Array.isArray(advice)) {
      // Filter out empty strings from the incoming advice array
      const filteredAdvice = advice.filter(item => item && item.trim() !== "");
      
      // Replace the entire advice array with the filtered version
      // This will handle both additions and deletions as the frontend
      // is sending the complete updated array
      expert.advice = filteredAdvice;
    }

    await expert.save();

    res.status(200).json({
      success: true,
      message: "About section updated successfully",
      data: {
        experience: expert.experience,
        advice: expert.advice,
      },
    });
  } catch (error) {
    console.error("Error updating about section:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while updating the about section.",
      error: error.message,
    });
  }
};



// Helper function to generate a limited token for pending experts
const generatePendingToken = (expert) => {
  // Create a token with limited permissions and shorter expiry
  return jwt.sign(
    { 
      id: expert._id,
      role: expert.role,
      status: expert.status,
      isPending: true, // Special flag for pending experts
      // You can add other limited permissions here
      permissions: ['read-only']
    },
    process.env.JWT_SECRET || 'your_jwt_secret',
    { expiresIn: '24h' } // Shorter expiration time for pending experts
  );
};

// Get expert's availability
const getExpertAvailability = asyncHandler(async (req, res) => {
  try {
    const { expertId } = req.params;
    
    // Validate expertId format
    if (!expertId || !mongoose.Types.ObjectId.isValid(expertId)) {
      throw new ApiError(400, "Invalid expert ID format");
    }

    let availability = await ExpertAvailability.findOne({ expertId: new mongoose.Types.ObjectId(expertId) });
    
    if (!availability) {
      // Return empty availability if not found
      return res.status(200).json(new ApiResponse(200, {
        availability: [],
        timezone: "Asia/Kolkata",
        monthsRange: 1
      }, "No availability found"));
    }
    
    res.status(200).json(new ApiResponse(200, {
      availability: availability.availability || [],
      timezone: availability.timezone,
      monthsRange: availability.monthsRange
    }, "Availability retrieved successfully"));
  } catch (error) {
    console.error("Error fetching availability:", error);
    res.status(500).json(new ApiResponse(500, null, "Error fetching availability"));
  }
});

// Update expert's availability
const updateExpertAvailability = asyncHandler(async (req, res) => {
  try {
    const { expertId } = req.params;
    const { availability, timezone, monthsRange } = req.body;
    
    // Validate expertId format
    if (!expertId || !mongoose.Types.ObjectId.isValid(expertId)) {
      throw new ApiError(400, "Invalid expert ID format");
    }

    // Verify the expert making the request is the owner of the availability
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (token) {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      // Compare as strings to handle MongoDB ObjectId comparison
      if (decoded._id.toString() !== expertId.toString() && decoded.role !== "admin") {
        throw new ApiError(403, "Unauthorized to update this availability");
      }
    }
    
    let expertAvailability = await ExpertAvailability.findOne({ expertId: new mongoose.Types.ObjectId(expertId) });
    
    if (!expertAvailability) {
      expertAvailability = new ExpertAvailability({
        expertId: new mongoose.Types.ObjectId(expertId),
        availability: availability || [],
        timezone: timezone || "Asia/Kolkata",
        monthsRange: monthsRange || 1
      });
    } else {
      expertAvailability.availability = availability || expertAvailability.availability;
      expertAvailability.timezone = timezone || expertAvailability.timezone;
      expertAvailability.monthsRange = monthsRange || expertAvailability.monthsRange;
    }
    
    await expertAvailability.save();
    
    res.status(200).json(new ApiResponse(200, {
      availability: expertAvailability.availability,
      timezone: expertAvailability.timezone,
      monthsRange: expertAvailability.monthsRange
    }, "Availability updated successfully"));
  } catch (error) {
    console.error("Error updating availability:", error);
    // Send appropriate error response based on error type
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    } else {
      res.status(500).json(new ApiResponse(500, null, "Error updating availability"));
    }
  }
});

// Add this helper function in your controller to get expert ID from token
const getExpertIdFromToken = (req) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return null;
    
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    return decoded._id;
  } catch (error) {
    console.error("Error decoding token:", error);
    return null;
  }
};

const loginPendingExpert = asyncHandler(async (req, res) => {
  const { email, phone } = req.body;

  // Check if either email or phone is provided
  if (!email && !phone) {
    throw new ApiError(400, "Email or phone is required");
  }

  let expert;
  if (email) {
    expert = await Expert.findOne({ email });
  } else {
    const normalizedPhone = normalizePhoneNumber(phone);
    expert = await Expert.findOne({ phone: normalizedPhone });
  }

  if (!expert) {
    throw new ApiError(404, "Expert not found");
  }

  // Check if expert status is Pending
  if (expert.status !== "Pending") {
    throw new ApiError(403, "This endpoint is only for experts with Pending status");
  }

  // Generate a limited access token for pending experts
  const token = jwt.sign(
    {
      _id: expert._id,
      role: "expert",
      status: "Pending",
      isPending: true,
      permissions: ["read-only"] // Limited permissions
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "24h" } // Shorter expiration for pending experts
  );

  // Return token and redirect path
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        redirectTo: "/reviewingexpertpanel", // Frontend should handle this redirect
        expert: {
          _id: expert._id,
          firstName: expert.firstName,
          lastName: expert.lastName,
          email: expert.email,
          phone: expert.phone,
          status: expert.status
        }
      },
      "Logged in as pending expert"
    )
  );
});


const deactivateExpert = asyncHandler(async (req, res) => {
  const expertId = req.params.id;
  const { reason } = req.body;

  if (!expertId) {
    return res.status(400).json({
      success: false,
      message: "Expert ID is required",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(expertId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid expert ID format",
    });
  }

  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "Reason for deactivation is required",
    });
  }

  try {
    const expert = await Expert.findByIdAndUpdate(
      expertId,
      {
        status: "Deactivated",
        deactivationReason: reason,
        deactivatedAt: Date.now(),
      },
      { new: true }
    );

    if (!expert) {
      return res.status(404).json({
        success: false,
        message: "Expert not found",
      });
    }

    await ExpertToExpertSession.updateMany(
      {
        consultingExpertID: expertId,
        status: { $in: ["confirmed", "unconfirmed"] },
      },
      {
        status: "cancelled",
        cancellationReason: "Expert deactivated their account",
      }
    );

    await UserToExpertSession.updateMany(
      {
        expertId: expertId,
        status: { $in: ["confirmed", "unconfirmed"] },
      },
      {
        status: "cancelled",
        cancellationReason: "Expert deactivated their account",
      }
    );

    return res.status(200).json({
      success: true,
      message: "Expert deactivated successfully",
      data: expert,
    });
  } catch (error) {
    console.error("Error deactivating expert:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// Backend API endpoint for checking account status
const checkAccountStatus = asyncHandler(async (req, res) => {
  const { email, phone } = req.body;
  
  if (!email && !phone) {
    return res.status(400).json({
      success: false,
      message: "Email or phone is required",
    });
  }

  let expert;

  if (email) {
    expert = await Expert.findOne({ email });
  } else if (phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    expert = await Expert.findOne({ phone: normalizedPhone });
  }

  if (!expert) {
    return res.status(404).json({
      success: false,
      message: "Expert not found",
    });
  }

  return res.status(200).json({
    success: true,
    status: expert.status,
    message: "Expert status retrieved successfully",
  });
});

// Backend API endpoint for reactivating account
const reactivateAccount = asyncHandler(async (req, res) => {
  const { email, phone } = req.body;
  
  if (!email && !phone) {
    return res.status(400).json({
      success: false,
      message: "Email or phone is required",
    });
  }

  let expert;

  if (email) {
    expert = await Expert.findOne({ email });
  } else if (phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    expert = await Expert.findOne({ phone: normalizedPhone });
  }

  if (!expert) {
    return res.status(404).json({
      success: false,
      message: "Expert not found",
    });
  }

  // Check if the expert is actually deactivated
  if (expert.status !== "Deactivated") {
    return res.status(400).json({
      success: false,
      message: "Account is not in deactivated state",
    });
  }

  // Update expert status to Approved
  expert.status = "Approved";
  expert.deactivatedAt = undefined;
  expert.deactivationReason = undefined;
  
  await expert.save();

  return res.status(200).json({
    success: true,
    message: "Account reactivated successfully",
  });
});

const getExpertTransactions = asyncHandler(async (req, res) => {
  const expertId = req.params.expertId;
  if (!expertId) {
    return res.status(400).json({
      success: false,
      message: "Expert ID is required",
    });
  }

  const transaction = await Transaction.find({ expertId: expertId })
  .populate('expertId', 'firstName lastName email phone')
  
  res.status(200).json(
    new ApiResponse(200, transaction, "Expert transactions retrieved successfully")
  );

});








export {
  requestOtp,
  verifyOtp,
  registerExpert,
  getExperts,
  getExpertById,
  logoutExpert,
  getExpertsByArea,
  updateExpertCharity,
  updateExpertPrice,
  updateExpert,
  updateExpertExperience,
  refreshToken,
  updateExpertProfile,
  loginPendingExpert,
  updateExpertProfilePicture,
  getExpertAvailability,
  updateExpertAvailability,
  getExpertIdFromToken,
  deactivateExpert,
  checkAccountStatus,
  reactivateAccount,
  getExpertTransactions

};