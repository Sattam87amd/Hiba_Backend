import mongoose from "mongoose";

const cancelSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'sessionModel' // Dynamic reference to session model
  },
  sessionModel: {
    type: String,
    required: true,
    enum: ['UserToExpertSession', 'ExpertToExpertSession']
  },
  Id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'userModel' // Dynamic reference to user/expert model
  },
  userModel: {
    type: String,
    required: true,
    enum: ['User', 'Expert']
  },
  reasons: {
    type: [String],
    required: true
  },
  otherReason: {
    type: String,
    default: ''
  },
  cancellationTime: {
    type: Date,
    default: Date.now
  },
  policyApplied: {
    type: String,
    default: ''
  }
}, { timestamps: true });

export const Cancel = mongoose.model("Cancel", cancelSchema);
