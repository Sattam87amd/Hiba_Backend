// utils/userVideoSDKHelper.js - Separate helper for user video calls
import crypto from 'crypto';

// Generate Video SDK signature specifically for users
const generateUserVideoSDKSignature = (meetingNumber, role = 0) => {
  const sdkKey = process.env.ZOOM_SDK_KEY;
  const sdkSecret = process.env.ZOOM_SDK_SECRET;
  
  console.log('Generating USER video signature for meeting:', meetingNumber);
  
  const timestamp = new Date().getTime() - 30000;
  const msg = Buffer.from(sdkKey + meetingNumber + timestamp + role).toString('base64');
  const hash = crypto.createHmac('sha256', sdkSecret).update(msg).digest('base64');
  
  const signature = Buffer.from(`${sdkKey}.${meetingNumber}.${timestamp}.${role}.${hash}`).toString('base64');
  
  return {
    signature,
    sdkKey,
    meetingNumber: meetingNumber.toString(),
    role, // 0 for user (attendee)
    timestamp,
    userType: 'user'
  };
};

export { generateUserVideoSDKSignature };