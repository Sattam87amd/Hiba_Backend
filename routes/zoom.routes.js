// zoomRoutes.js
import express from 'express';
import { generateZoomSignature } from '../controller/zoom.controller.js';
const router = express.Router();

router.post('/generate-signature', generateZoomSignature);

export default router;
