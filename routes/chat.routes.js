import express from 'express';
import { chatbotProxy } from '../controller/chat.controller.js';

const router = express.Router();

// Log when the route is hit
router.post('/', (req, res, next) => {
  console.log('POST /api/chatbot hit');
  next();
}, chatbotProxy);

export default router;