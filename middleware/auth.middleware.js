import asyncHandler from "./../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import jwt from "jsonwebtoken";
import { User } from "../model/user.model.js";  // User model
import { Expert } from "../model/expert.model.js";  // Expert model

const VerifyJwt = asyncHandler(async (req, res, next) => {
  try {
    // Extract the token from the Authorization header
    let token =
      req.header("Authorization")?.replace("Bearer ", "") || // From Authorization header
      req.body.token;  // Or from the request body

   
    // If no token is found, throw an error
    if (!token || token.trim() === "") {
      throw new ApiError(401, "Unauthorized Request: No token provided");
    }

    // Check if the token format is valid (JWT should have 3 parts separated by '.')
    if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(token)) {
      throw new ApiError(401, "Invalid token format: Token is malformed");
    }

    // Verify the token
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Debugging to verify decoded token

    let user = null;
    let expert = null;

    // Check if the token is for a user or an expert
    if (decodedToken?.role === 'user') {
      // Fetch the user associated with the token
      user = await User.findById(decodedToken?._id).select("-password -refreshToken");

      if (!user) {
        throw new ApiError(401, "Invalid Access Token: User not found");
      }

      // Attach user data to the request for downstream use
      req.user = user;
    } else if (decodedToken?.role === 'expert') {
      // Fetch the expert associated with the token using _id (not expertId)
      expert = await Expert.findById(decodedToken?._id); // Use _id directly here

      // Log the expert to verify if the query is correct

      if (!expert) {
        throw new ApiError(401, "Invalid Access Token: Expert not found");
      }

      // Attach expert data to the request for downstream use, using req.user
      req.user = expert;
    } else {
      throw new ApiError(401, "Invalid Access Token: Role not found");
    }

    next(); // Continue to the next middleware/route
  } catch (error) {
    // Handle specific errors
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, "Token has expired");
    }

    if (error.name === 'JsonWebTokenError') {
      throw new ApiError(401, "Invalid token format");
    }

    // For other errors, return a generic message
    throw new ApiError(402, error.message || "Invalid Access Token");
  }
});

export default VerifyJwt;
