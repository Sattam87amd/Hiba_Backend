import mongoose from 'mongoose';

const timeSlotSchema = new mongoose.Schema({
  date: {
    type: String, // Format: YYYY-MM-DD
    required: true
  },
  times: {
    type: Map,
    of: Boolean,
    default: () => new Map()
  }
});

const expertAvailabilitySchema = new mongoose.Schema({
  expertId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Expert',
    required: true,
    unique: true
  },
  availability: [timeSlotSchema],
  timezone: {
    type: String,
    default: "Asia/Kolkata"
  },
  monthsRange: {
    type: Number,
    default: 1
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Update the updatedAt field on every save
expertAvailabilitySchema.pre('save', function() {
  this.updatedAt = new Date();
});

export const ExpertAvailability = mongoose.models.ExpertAvailability || 
  mongoose.model('ExpertAvailability', expertAvailabilitySchema);
