import { GoogleAuth } from 'google-auth-library';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export async function getAccessToken() {
  const auth = new GoogleAuth({
    keyFile: path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    scopes: 'https://www.googleapis.com/auth/generative-language', // Specific to Gemini API
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token || tokenResponse;
}
