import express from 'express';
import TireController from '../controller/tire.controller.js';

const router = express.Router();

router.get('/', TireController.getAll);
router.put('/:id', TireController.update);
router.post('/', TireController.create);

export default router;