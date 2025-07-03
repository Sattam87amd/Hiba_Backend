import express from "express";
import cancelSession from "../controller/cancelsession.controller.js"; // Adjust path as needed

const router = express.Router();


router.post("/canceluser", cancelSession);


router.post("/cancelexpert", cancelSession);

export default router;
