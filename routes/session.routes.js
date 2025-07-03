import { Router } from "express";
import getAllSessions from "../controller/session.controller.js";

const router = Router();

router.get('/getallsessions', getAllSessions)

export default router