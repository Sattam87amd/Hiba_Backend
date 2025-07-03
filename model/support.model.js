import mongoose from "mongoose";

const supportSchema = new mongoose.Schema({
    name: {
        type: String,
        required: false, // Optional for feedback submissions
    },
    email: {
        type: String,
        required: true,
    },
    phone: {
        type: String,
        required: true,
    },
    subject: {
        type: String,
        required: false, // Required only for feature and topic suggestions
    },
    message: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: ["feedback", "feature", "topic"],
        required: true,
        default: "feedback"
    },
    status: {
        type: String,
        enum: ["pending", "reviewed", "responded", "implemented", "rejected"],
        default: "pending"
    }
}, { timestamps: true, collection: "support" });

// Remove unique constraints to allow multiple submissions from the same user
// Add compound index for better query performance
supportSchema.index({ email: 1, type: 1 });
supportSchema.index({ type: 1, status: 1 });
supportSchema.index({ createdAt: -1 });

export const Support = mongoose.models.Support || mongoose.model("Support", supportSchema);