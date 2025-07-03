import jwt from "jsonwebtoken";
import { UserToExpertSession } from "../model/usertoexpertsession.model.js";
import { ExpertToExpertSession } from "../model/experttoexpertsession.model.js";
import { Cancel } from "../model/cancel.model.js";
import { sendEmail } from "../utils/emailService.js";
import { Expert } from "../model/expert.model.js";
import { User } from "../model/user.model.js";

const cancelSession = async (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ success: false, message: "Token is required" });
  }

  try {
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const cancellerId = decodedToken._id;
    const cancellerRole = decodedToken.role;

    const { sessionId, reasons, otherReason, sessionModel } = req.body;

    let session;
    let SessionModel;
    let recipientEmail;
    let recipientFirstName;
    let recipientLastName;
    let cancellerName;

    // Determine the model and query based on sessionModel from request
    switch (sessionModel) {
      case "ExpertToExpertSession":
        SessionModel = ExpertToExpertSession;
        session = await SessionModel.findOne({ 
          _id: sessionId, 
          consultingExpertID: cancellerId 
        }).populate('expertId', 'firstName lastName email'); 
        
        if (session) {
          recipientEmail = session.expertId.email;
          recipientFirstName = session.expertId.firstName;
          recipientLastName = session.expertId.lastName;
          const cancellingExpert = await Expert.findById(cancellerId);
          cancellerName = `${cancellingExpert.firstName} ${cancellingExpert.lastName}`;
        }
        break;
      case "UserToExpertSession":
        SessionModel = UserToExpertSession;
        const query = cancellerRole === "expert" 
          ? { _id: sessionId, expertId: cancellerId } 
          : { _id: sessionId, userId: cancellerId };
        session = await SessionModel.findOne(query)
            .populate('userId', 'firstName lastName email') 
            .populate('expertId', 'firstName lastName'); 

        if (session) {
            if (cancellerRole === "expert") {
                recipientEmail = session.userId.email;
                recipientFirstName = session.userId.firstName;
                recipientLastName = session.userId.lastName;
                cancellerName = `${session.expertId.firstName} ${session.expertId.lastName}`;
            } else {
                recipientEmail = session.expertId.email;
                recipientFirstName = session.expertId.firstName;
                recipientLastName = session.expertId.lastName;
                const cancellingUser = await User.findById(cancellerId);
                cancellerName = `${cancellingUser.firstName} ${cancellingUser.lastName}`;
            }
        }
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid session model" });
    }

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found or you don't have permission to cancel it.",
      });
    }

    if (session.status === 'cancelled' || session.status === 'completed' || session.status === 'rejected') {
        return res.status(400).json({ success: false, message: "Session cannot be cancelled from its current status." });
    }

    const sessionDateTime = new Date(session.slots[0].selectedDate + ' ' + session.slots[0].selectedTime);
    const now = new Date();
    const hoursDifference = (sessionDateTime - now) / (1000 * 60 * 60);
    const cancellationFee = hoursDifference < 24 ? "Cancellation fee may apply" : "No cancellation fee";

    let emailSubject = `Session Cancellation Notification`;
    let emailHtml = `<h1>Session Cancelled!</h1>
                     <p>Dear ${recipientFirstName || 'User'},</p>
                     <p>Your session with expert ${cancellerName} (Session ID: ${sessionId}) has been cancelled.</p>
                     <p><strong>Reason(s) for cancellation:</strong></p>
                     <ul>`;

    reasons.forEach(reason => {
        emailHtml += `<li>${reason}</li>`;
    });
    if (otherReason) {
        emailHtml += `<li>Other: ${otherReason}</li>`;
    }
    emailHtml += `</ul>
                  <p>Cancellation Policy Applied: ${cancellationFee}</p>
                  <p>We apologize for any inconvenience this may cause.</p>
                  <p>Thank you for using our platform.</p>`;

    if (recipientEmail) {
        await sendEmail({
            to: recipientEmail,
            subject: emailSubject,
            html: emailHtml
        });
        console.log(`Cancellation email sent to ${recipientEmail} for session ${sessionId}`);
    } else {
        console.warn(`Could not send cancellation email for session ${sessionId}: recipient email not found.`);
    }

    const cancelEntry = new Cancel({
      sessionId,
      sessionModel,
      cancellerId,
      userModel: cancellerRole === "expert" ? "Expert" : "User",
      reasons,
      otherReason,
      cancellationTime: now,
      policyApplied: cancellationFee,
    });

    await cancelEntry.save();

    session.status = 'cancelled';
    await session.save(); 

    await SessionModel.deleteOne({ _id: sessionId });

    return res.status(200).json({
      success: true,
      message: "Session cancelled and deleted successfully.",
      cancellationFee,
    });

  } catch (error) {
    console.error("Error cancelling session:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export default cancelSession 