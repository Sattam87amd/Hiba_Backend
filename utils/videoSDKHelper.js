import crypto from 'crypto';
// Generate Video SDK signature
const generateVideoSDKSignature = (meetingNumber, role = 0) => {
  const sdkKey = process.env.ZOOM_SDK_KEY;
  const sdkSecret = process.env.ZOOM_SDK_SECRET;
  
  const timestamp = new Date().getTime() - 30000;
  const msg = Buffer.from(sdkKey + meetingNumber + timestamp + role).toString('base64');
  const hash = crypto.createHmac('sha256', sdkSecret).update(msg).digest('base64');
  
  const signature = Buffer.from(`${sdkKey}.${meetingNumber}.${timestamp}.${role}.${hash}`).toString('base64');
  
  return {
    signature,
    sdkKey,
    meetingNumber: meetingNumber.toString(),
    role,
    timestamp
  };
};

// Generate a unique meeting number (you can use your own logic)
const generateMeetingNumber = () => {
  return Math.floor(Math.random() * 9000000000) + 1000000000; // 10-digit number
};


export { generateVideoSDKSignature, generateMeetingNumber };