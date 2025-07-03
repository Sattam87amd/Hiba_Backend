import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export const getZoomAccessToken = async () => {
  const token = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64');

  const res = await axios.post(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
    {},
    {
      headers: {
        Authorization: `Basic ${token}`,
      },
    }
  );

  return res.data.access_token;
};
