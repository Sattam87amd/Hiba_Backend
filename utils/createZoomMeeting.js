import axios from 'axios';
import { getZoomAccessToken } from './zoomToken.js';

export const createZoomMeeting = async (hostEmail, topic, startTime, duration) => {
  const accessToken = await getZoomAccessToken();

  hostEmail = "aquibhingwala@gmail.com"

  const res = await axios.post(
    `https://api.zoom.us/v2/users/${hostEmail}/meetings`,
    {
      topic,
      type: 2,
      start_time: startTime,
      duration,
      timezone: "Asia/Kolkata",
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return res.data;
};
