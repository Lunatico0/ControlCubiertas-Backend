import express from 'express';
import TireController from '../controller/tire.controller.js';
import { validateTireExists } from '../middleware/tireExists.js';

const router = express.Router();

// Rutas para la gestión de llantas (CRUD completo)
router.get('/', TireController.getAll);
router.get('/next-number', TireController.getNextReceiptNumber);
router.get('/next-order', TireController.getNextOrderNumber);
router.get('/:id', validateTireExists, TireController.getById);
router.post('/', TireController.create);

// Cambios con impacto en historial
router.patch('/:id/status', validateTireExists, TireController.updateStatus);     // cambio de estado con km y history
router.patch('/:id/assign', validateTireExists, TireController.assignVehicle);    // asignar a vehículo (km Alta)
router.patch('/:id/unassign', validateTireExists, TireController.unassignVehicle);  // desasignar de vehículo (km Baja)
router.patch('/:id/correct', validateTireExists, TireController.correctData);      // corrección de datos con flag en history
router.patch('/:id/history/:historyId', validateTireExists, TireController.updateHistory);    // actualizar un registro del historial

router.post('/:id/history/:historyId/undo', validateTireExists, TireController.undoHistoryEntry); // Deshacer un registro del historial

export default router;
