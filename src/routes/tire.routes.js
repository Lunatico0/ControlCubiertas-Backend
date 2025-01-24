import express from 'express';
import TireController from '../controller/tire.controller.js';
import { validateTireExists } from '../middleware/tireExists.js';

const router = express.Router();

router.get('/', TireController.getAll);
router.get('/:id', validateTireExists, TireController.getById);
router.put('/:id', validateTireExists, TireController.update);
router.post('/', TireController.create);

export default router;