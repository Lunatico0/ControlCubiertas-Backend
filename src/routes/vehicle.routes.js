import express from 'express';
import VehicleController from '../controller/vehicle.controller.js';
import { validateVehicleExists } from '../middleware/vehicleExists.js';

const router = express.Router();

router.get('/',  VehicleController.getAll);
router.put('/:id', validateVehicleExists,VehicleController.update)
router.post('/', VehicleController.create);

export default router;