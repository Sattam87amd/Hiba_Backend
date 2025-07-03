import { Expert } from '../model/expert.model.js';
import { UserToExpertSession } from '../model/usertoexpertsession.model.js';
import { ExpertToExpertSession } from '../model/experttoexpertsession.model.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import asyncHandler from '../utils/asyncHandler.js';

dotenv.config();

// Controller to update free session settings for an expert
const updateFreeSessionSettings = asyncHandler(async (req, res) => {
  try {
    // Extract the token from the Authorization header (Bearer <token>)
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    // Decode the token to get the expert _id
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    console.log("Decoded token:", decoded);

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
        message: "Expert not found"
      });
    }

    const { freeSessionEnabled } = req.body;

    // Update the expert's free session setting
    expert.freeSessionEnabled = freeSessionEnabled;
    await expert.save();

    res.status(200).json({
      success: true,
      message: "Free session settings updated successfully",
      data: {
        freeSessionEnabled: expert.freeSessionEnabled
      }
    });
  } catch (error) {
    console.error("Error updating free session settings:", error);
    res.status(500).json({
      success: false,
      message: "Error updating free session settings",
      error: error.message
    });
  }
});

// Function to check if a user is eligible for a free session with an expert
const checkFreeSessionEligibility = asyncHandler(async (req, res) => {
  const { userId, expertId } = req.params;

  if (!userId || !expertId) {
    return res.status(400).json({
      success: false,
      message: "User ID and Expert ID are required"
    });
  }

  try {
    const expert = await Expert.findById(expertId);
    if (!expert) return res.status(404).json({ success: false, message: "Expert not found" });
    if (!expert.freeSessionEnabled) return res.json({ success: true, eligible: false });

    // Check for valid sessions in both collections
    const [userSessions, expertSessions] = await Promise.all([
      UserToExpertSession.findOne({
        userId,
        expertId,
        status: { 
          $not: /cancelled/i // Regex pattern
        }
      }),
      ExpertToExpertSession.findOne({
        expertId: userId,
        consultingExpertID: expertId,
        status: { 
          $not: /cancelled/i 
        }
      })
    ]);

    const isEligible = !userSessions && !expertSessions;

    res.status(200).json({
      success: true,
      eligible: isEligible,
      message: isEligible 
        ? "Eligible for free session" 
        : "Existing sessions found with expert"
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});



export {
  updateFreeSessionSettings,
  checkFreeSessionEligibility
};