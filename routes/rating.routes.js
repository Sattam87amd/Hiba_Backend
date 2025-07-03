import express from 'express';
import { createRating, getExpertRating, updateBookingStatus } from '../controller/rating.controller.js';

const router = express.Router();

/**
 * @route  POST /api/ratings
 * @desc   Submit a new rating
 */
router.post('/', createRating);

/**
 * @route  GET /api/ratings/:expertId
 * @desc   Get aggregated rating details for one expert
 */
router.get('/:expertId', getExpertRating);

router.put('/update-status/:id', updateBookingStatus); // PUT request to update status


export default router;
