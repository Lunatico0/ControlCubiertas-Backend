import express from 'express';
import { checkOrderExists } from '../controller/order.controller.js';

const router = express.Router();

router.get('/check/:formattedOrder', checkOrderExists);

export default router;
