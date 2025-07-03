import express from "express";
import { GiveUsFeedback, SuggestFeature, SuggestTopic } from "../controller/support.controller.js";

const router = express.Router();

/**
 * Support Routes
 * Handles all types of user feedback and suggestions
 */

// User feedback route
router.post("/feedback", GiveUsFeedback);

// Feature suggestion route
router.post("/feature", SuggestFeature);

// Topic/expert suggestion route
router.post("/topic", SuggestTopic);

export default router;