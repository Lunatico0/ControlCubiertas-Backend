import express from 'express';
import TireController from '../controller/tire.controller.js';
import { validateTireExists } from '../middleware/tireExists.js';

const router = express.Router();

// Rutas para la gestión de llantas (CRUD completo)
router.get('/', TireController.getAll);
router.get('/:id', validateTireExists, TireController.getById);
router.post('/', TireController.create);

// Cambios con impacto en historial
router.patch('/:id/status', validateTireExists, TireController.updateStatus);      // cambio de estado con km y history
router.patch('/:id/assign', validateTireExists, TireController.assignVehicle);     // asignar a vehículo (km Alta)
router.patch('/:id/unassign', validateTireExists, TireController.unassignVehicle); // desasignar de vehículo (km Baja)
router.patch('/:id/correct', validateTireExists, TireController.correctData);      // corrección de datos con flag en history

export default router;
