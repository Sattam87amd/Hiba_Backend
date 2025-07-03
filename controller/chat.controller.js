import fetch from 'node-fetch';
import dotenv from 'dotenv';
import Chat from '../model/chat.Model.js';
import { getAccessToken } from '../middleware/googleAuth.js';  // Adjust the path if needed

dotenv.config();

export const chatbotProxy = async (req, res) => {
  const { message } = req.body;  

  // Now, instead of using an API key, obtain a valid OAuth token.
  try {
    const accessToken = await getAccessToken(); // Get the OAuth 2.0 token

    // Call the Gemini API with the valid access token
    const response = await fetch(process.env.GEMINI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`, // from getAccessToken()
        },
        body: JSON.stringify({
          contents: [
            {
              // role: "user",
              parts: [
                { text: message }
              ]
            }
          ]
        }),
      });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API error: ${response.status} - ${errorText}`);
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

// ✅ Safely extract Gemini reply
const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

if (!reply) {
  throw new Error("No reply returned from Gemini API.");
}

// ✅ Save to DB
const chatLog = new Chat({
  userMessage: message,
  botReply: reply,
});
await chatLog.save();

// ✅ Return response
return res.status(200).json({ reply });
  } catch (error) {
    console.error('Error in chatbot proxy:', error);
    return res.status(500).json({ 
      error: 'Error communicating with the Gemini API. Detailed error: ' + error.message 
    });
  }
};
