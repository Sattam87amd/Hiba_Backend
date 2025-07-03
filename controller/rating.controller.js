import mongoose from 'mongoose';
import Rating from '../model/rating.model.js';
import { ExpertToExpertSession } from '../model/experttoexpertsession.model.js';
import { Expert } from '../model/expert.model.js';
import { User } from '../model/user.model.js'; // Import User model if needed
import {UserToExpertSession} from '../model/usertoexpertsession.model.js';

/**
 * @desc    Create a new rating
 * @route   POST /api/ratings
 * @access  Public or Protected (depends on your setup)
 */
export const createRating = async (req, res) => {
  try {
    const { expertId, raterId, sessionType, rating, comment, raterType } = req.body;

    // Basic validations
    if (!expertId || !raterId || !sessionType || rating == null) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Create and save the rating document
    const newRating = new Rating({
      expertId,
      raterId,
      sessionType,
      rating,
      comment,
      raterType,
    });

    await newRating.save();

    // Now update the Expert model with the new rating and recalculate the average rating
    const expert = await Expert.findById(expertId);

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    // Ensure ratings array is initialized
    if (!expert.ratings) {
      expert.ratings = [];  // Initialize the ratings array if it's not already initialized
    }

    // Add the new rating to the expert's ratings array
    expert.ratings.push(newRating._id);
    expert.numberOfRatings += 1;

    // Recalculate the average rating using incremental calculation
    const previousAverageRating = expert.averageRating;
    const previousNumberOfRatings = expert.numberOfRatings - 1; // Before this new rating

    const newAverageRating = (previousAverageRating * previousNumberOfRatings + rating) / expert.numberOfRatings;

    expert.averageRating = newAverageRating;

    // Save the expert model with the updated ratings and average rating
    await expert.save();

    return res.status(201).json({
      message: 'Rating submitted successfully',
      rating: newRating,
    });
  } catch (error) {
    console.error('Error creating rating:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get aggregated rating AND detailed reviews for an expert
 * @route   GET /api/ratings/:expertId
 * @access  Public or Protected (depends on your setup)
 */
export const getExpertRating = async (req, res) => {
  try {
    const { expertId } = req.params;

    // Validate expertId
    if (!expertId) {
      return res.status(400).json({ message: 'Expert ID is required' });
    }

    console.log(`Fetching ratings for expertId: ${expertId}`);

    // Use aggregation to compute average rating and total rating count
    const aggregateResult = await Rating.aggregate([
      {
        $match: {
          expertId: new mongoose.Types.ObjectId(expertId),
        },
      },
      {
        $group: {
          _id: '$expertId',
          averageRating: { $avg: '$rating' },
          ratingCount: { $sum: 1 },
        },
      },
    ]);

    // Find all detailed ratings for this expert
    const detailedRatings = await Rating.find({ 
      expertId: new mongoose.Types.ObjectId(expertId) 
    })
    .sort({ createdAt: -1 })
    .lean();

    // console.log(`Found ${detailedRatings.length} ratings for expert`);
    
    // if (detailedRatings.length > 0) {
    //   console.log("Sample rating:", JSON.stringify(detailedRatings[0]));
    // }

    // Process the ratings to include rater information
    const processedRatings = await Promise.all(
      detailedRatings.map(async (rating) => {
        let raterName = 'Anonymous User';
        let raterImage = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?ixlib=rb-1.2.1&auto=format&crop=faces&fit=crop&w=100&h=100&q=80';
        let raterRole = rating.raterType;
        let sessionDuration = 'N/A'; // Default duration
        let actualSessionId = rating.sessionId; // The ID of the session being rated

        try {
          if (rating.raterType === 'Expert') {
            const expert = await Expert.findById(rating.raterId).lean();
            if (expert) {
              // Combine firstname + lastname if they exist
              raterName = expert.name || [expert.firstName, expert.lastName].filter(Boolean).join(' ') || 'Anonymous Expert';
              raterImage = expert.profileImage || expert.photoFile || raterImage;
              raterRole = expert.currentRole || expert.expertise || 'Expert';
            }
          } else if (rating.raterType === 'User') {
            const user = await User.findById(rating.raterId).lean();
            // console.log('Fetched User:', user);
            if (user) {
              raterName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Anonymous User';
              raterImage = user.profileImage || user.photoFile || raterImage; // Ensure this matches your User model's field
              raterRole = 'User';
            }
          }

          // Fetch session details using rating.sessionId and rating.sessionModelName
          if (rating.sessionId && rating.sessionModelName) {
            const SessionModel = mongoose.model(rating.sessionModelName);
            const sessionDoc = await SessionModel.findById(rating.sessionId).lean();
            if (sessionDoc) {
              sessionDuration = sessionDoc.duration || 'N/A';
            }
          }
        } catch (err) {
          console.error(`Error fetching rater or session details for rating ${rating._id}: ${err.message}`);
        }

        return {
          _id: rating._id,
          sessionId: actualSessionId, 
          raterName: raterName,
          rating: rating.rating,
          dateTime: rating.createdAt,
          duration: sessionDuration, 
          comment: rating.comment,
          raterImage,
          raterRole,
        };
      })
    );

    // console.log(`Processed ${processedRatings.length} ratings with user info`);
    // if (processedRatings.length > 0) {
    //   console.log("Sample processed rating:", JSON.stringify(processedRatings[0]));
    // }

    // If no ratings found, return defaults
    if (!aggregateResult || aggregateResult.length === 0) {
      return res.status(200).json({
        expertId,
        averageRating: 0,
        ratingCount: 0,
        data: []  // Empty array for no reviews
      });
    }

    // Return both the aggregated result and detailed reviews
    const response = {
      expertId: aggregateResult[0]._id.toString(),
      averageRating: aggregateResult[0].averageRating,
      ratingCount: aggregateResult[0].ratingCount,
      data: processedRatings  // Array of all reviews with rater details
    };
    
    // console.log(`Sending response with ${response.data.length} ratings`);
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching expert rating:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const updateBookingStatus = async (req, res) => {
  const { id } = req.params;
  const { status, sessionType } = req.body;

  if (status !== "Rating Submitted") {
    return res.status(400).json({ message: "Invalid status update" });
  }

  try {
    let updatedSession;

    if (sessionType === "expert-to-expert") {
      updatedSession = await ExpertToExpertSession.findByIdAndUpdate(
        id,
        { status: "Rating Submitted" },
        { new: true }
      );
    } else if (sessionType === "user-to-expert") {
      updatedSession = await UserToExpertSession.findByIdAndUpdate(
        id,
        { status: "Rating Submitted" },
        { new: true }
      );
    } else {
      return res.status(400).json({ message: "Invalid session type" });
    }

    if (!updatedSession) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({
      message: "Booking status updated to Rating Submitted",
      booking: updatedSession,
    });
  } catch (error) {
    console.error("Error updating booking status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};