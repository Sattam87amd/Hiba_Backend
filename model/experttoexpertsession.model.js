import mongoose, { Schema } from 'mongoose';

const experttoexpertsessionSchema = new Schema({
  consultingExpertID:{
    type:mongoose.Schema.Types.ObjectId,
    required:true,
    ref:'Expert'
  },
  
  expertId:{
      type:mongoose.Schema.Types.ObjectId,
        required:true,
        ref:'Expert',
    },
       areaOfExpertise: {
        type: String,
        enum: ['Home', 'Digital Marketing', 'Technology', 'Style and Beauty', 'HEalth and Wellness'],
        required: true, // Category for the appointment
      },
      // sessionDate: {
      //   type: Date,
      //   required: true, // Date of the appointment
      // },
      // sessionTime: {
      //   type: String,
      //   required: true, // Time of the appointment (string format like '10:00 AM', '2:00 PM', etc.)
      // },
      slots: [{
        type: Array
      }],
      status: {
        type: String,
        enum: ['pending', 'unconfirmed' , 'confirmed', 'completed' , 'rejected', 'Rating Submitted'],
        default: 'pending', // Status of the appointment
      },
      rating: {
        type: Number,
        min: 1,
        max: 5,
        default: null
      },
      payoutProcessed: {
        type: Boolean,
        default: false
      },
      expertPayoutAmount: {
        type: Number,
        default: 0
      },
      platformFeeAmount: {
        type: Number,
        default: 0
      },
      duration: {
        type: String,
        enum: ['Quick - 15min', 'Regular - 30min', 'Extra - 45min', 'All Access - 60min'],
        required: true, // Duration of the appointment
      },
      note: {
        type: String, // Optional note for the appointment
        default: '',
      },
      firstName:{
        type:String,
      },
      lastName:{
        type:String
      },
      mobile:{
        type:Number
      },
      sessionType:{type: String},
      
     // In your existing model:
zoomMeetingLink: {
  type: String, // Now stores: "/video-call?meetingId=1234567890&sessionId=sessionId"
  default: '',
},
zoomMeetingId: {
  type: String, // Now stores: the meeting number (e.g., "1234567890")
  default: '',
},
zoomPassword: {
  type: String, // Can be left empty for Video SDK or store additional data
  default: '',
},

// Optional: Add new fields specifically for Video SDK if needed
videoSDKMeetingNumber: {
  type: String, // Dedicated field for Video SDK meeting number
  default: '',
},
videoSDKTopic: {
  type: String, // Meeting topic/title
  default: '',
},

      paymentStatus:{type:String},
      paymentId:{type:String},
      paymentAmount:{
        type:Number,
        default: 0
      },
      price: { // Added price field, ensure it exists
        type: Number,
        required: true,
        default: 0
      },
      paymentReference: { // Added paymentReference field
        type: String
      },
      paymentMethod: { 
        type: String, 
        enum: ['tap', 'wallet', 'free', 'not_applicable', 'gift_card', 'gift_card_plus_wallet'], 
        default: 'wallet' 
      },
      ratingComment: { type: String, trim: true }, // This was re-added, ensure it's intended or remove if covered by Rating model
      giftCardRedeemedId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GiftCard',
        default: null
      },
      giftCardAmountRedeemed: {
        type: Number,
        default: 0
      }
    },
    { timestamps: true } // Automatically adds createdAt and updatedAt fields
  );

  export const ExpertToExpertSession = mongoose.model('ExpertToExpertSession', experttoexpertsessionSchema);

