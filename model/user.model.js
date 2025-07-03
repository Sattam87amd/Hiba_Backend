import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      match: /^\d{8,15}$/,
    },
    firstName: String,
    lastName: String,
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    otp: String,
    otpExpires: Date,
    role: {
      type: String,
      enum: ["user"],
    },
    photoFile: String,
    
    walletBalance: {
    type: Number,
    default: 0
  },
  transactions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }],
  },
    
  { timestamps: true, collection: "user" }
);


export const User = mongoose.models.User || mongoose.model("User", userSchema);
