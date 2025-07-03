import { UserToExpertSession } from "../model/usertoexpertsession.model.js";
import { ExpertToExpertSession } from "../model/experttoexpertsession.model.js";
import Rating from "../model/rating.model.js";

const getAllSessions = async (req, res) => {
  try {
    // Fetch user-to-expert sessions with full population
    const userSessions = await UserToExpertSession.find()
      .populate({
        path: 'userId',
        select: 'firstName lastName phone mobile'
      })
      .populate({
        path: 'expertId',
        select: 'firstName lastName'
      })
      .lean();

    // Fetch expert-to-expert sessions with full population
    const expertSessions = await ExpertToExpertSession.find()
      .populate({
        path: 'consultingExpertID',
        select: 'firstName lastName'
      })
      .populate({
        path: 'expertId',
        select: 'firstName lastName'
      })
      .lean();

    // Format user-to-expert sessions
    const formattedUserSessions = await Promise.all(userSessions.map(async (session) => {
      const rating = await Rating.findOne({ sessionId: session._id }).lean();
      
      return {
        ...session,
        sessionType: "User To Expert",
        firstName: session.userId?.firstName || "",
        lastName: session.userId?.lastName || "",
        expertName: session.expertId?.firstName || "",
        expertLastName: session.expertId?.lastName || "",
        phone: session.userId?.phone || "",
        mobile: session.userId?.mobile || "",
        sessionDate: session.createdAt
          ? new Date(session.createdAt).toLocaleString('en-GB', { 
              timeZone: 'Asia/Kolkata', 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit', 
              hour12: true 
            })
          : null,
        duration: session.duration || null,
        comment: rating?.comment || null,
      };
    }));

    // Format expert-to-expert sessions
    const formattedExpertSessions = await Promise.all(expertSessions.map(async (session) => {
      const rating = await Rating.findOne({ sessionId: session._id }).lean(); // Fixed from Id to sessionId
      
      return {
        ...session,
        sessionType: "Expert To Expert",
        firstName: session.consultingExpertID?.firstName || "",
        lastName: session.consultingExpertID?.lastName || "",
        expertName: session.expertId?.firstName || "",
        expertLastName: session.expertId?.lastName || "",
        sessionDate: session.createdAt
          ? new Date(session.createdAt).toLocaleString('en-GB', { 
              timeZone: 'Asia/Kolkata', 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit', 
              hour12: true 
            })
          : null,
        duration: session.duration || null,
        comment: rating?.comment || null,
      };
    }));

    // Return both formatted session lists
    res.status(200).json({
      success: true,
      userSessions: formattedUserSessions,
      expertSessions: formattedExpertSessions,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export default getAllSessions