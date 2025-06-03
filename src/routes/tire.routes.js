import express from 'express';
import TireController from '../controller/tire.controller.js';
import { validateTireExists } from '../middleware/tireExists.js';

const router = express.Router();

/**
 * @swagger
 * /api/tires:
 *   get:
 *     summary: Obtener todas las cubiertas
 *     tags: [Cubiertas]
 *     responses:
 *       200:
 *         description: Lista de todas las cubiertas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Tire'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', TireController.getAll);

/**
 * @swagger
 * /api/tires/next-number:
 *   get:
 *     summary: Obtener el siguiente número de recibo
 *     tags: [Cubiertas]
 *     responses:
 *       200:
 *         description: Número de recibo generado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReceiptNumber'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/next-number', TireController.getNextReceiptNumber);

/**
 * @swagger
 * /api/tires/{id}:
 *   get:
 *     summary: Obtener una cubierta por ID
 *     tags: [Cubiertas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cubierta
 *     responses:
 *       200:
 *         description: Datos de la cubierta con historial
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               allOf:
 *                 - $ref: '#/components/schemas/Tire'
 *                 - type: object
 *                   properties:
 *                     history:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/History'
 *       404:
 *         description: Cubierta no encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', validateTireExists, TireController.getById);

/**
 * @swagger
 * /api/tires:
 *   post:
 *     summary: Crear una nueva cubierta
 *     tags: [Cubiertas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *               - code
 *               - brand
 *               - pattern
 *               - serialNumber
 *             properties:
 *               status:
 *                 type: string
 *                 enum: ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada']
 *               code:
 *                 type: number
 *               brand:
 *                 type: string
 *               pattern:
 *                 type: string
 *               serialNumber:
 *                 type: string
 *               kilometers:
 *                 type: number
 *                 default: 0
 *               vehicle:
 *                 type: string
 *               orderNumber:
 *                 type: string
 *               createdAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Cubierta creada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tire'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', TireController.create);

/**
 * @swagger
 * /api/tires/{id}/status:
 *   patch:
 *     summary: Actualizar el estado de una cubierta
 *     tags: [Cubiertas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cubierta
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada']
 *               orderNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Estado actualizado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 tire:
 *                   $ref: '#/components/schemas/Tire'
 *       404:
 *         description: Cubierta no encontrada
 *       500:
 *         description: Error del servidor
 */
router.patch('/:id/status', validateTireExists, TireController.updateStatus);

/**
 * @swagger
 * /api/tires/{id}/assign:
 *   patch:
 *     summary: Asignar cubierta a un vehículo
 *     tags: [Cubiertas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cubierta
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicle
 *               - kmAlta
 *             properties:
 *               vehicle:
 *                 type: string
 *                 description: ID del vehículo
 *               kmAlta:
 *                 type: number
 *                 description: Kilómetros de alta
 *               orderNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cubierta asignada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 tire:
 *                   $ref: '#/components/schemas/Tire'
 *       400:
 *         description: Datos inválidos o cubierta ya asignada
 *       404:
 *         description: Cubierta no encontrada
 */
router.patch('/:id/assign', validateTireExists, TireController.assignVehicle);

/**
 * @swagger
 * /api/tires/{id}/unassign:
 *   patch:
 *     summary: Desasignar cubierta de un vehículo
 *     tags: [Cubiertas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cubierta
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - kmBaja
 *             properties:
 *               kmBaja:
 *                 type: number
 *                 description: Kilómetros de baja
 *               orderNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cubierta desasignada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 tire:
 *                   $ref: '#/components/schemas/Tire'
 *                 kmAlta:
 *                   type: number
 *                 kmBaja:
 *                   type: number
 *                 kmRecorridos:
 *                   type: number
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Cubierta no encontrada
 */
router.patch('/:id/unassign', validateTireExists, TireController.unassignVehicle);

/**
 * @swagger
 * /api/tires/{id}/correct:
 *   patch:
 *     summary: Corregir datos de una cubierta
 *     tags: [Cubiertas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cubierta
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               serialNumber:
 *                 type: string
 *               code:
 *                 type: number
 *               brand:
 *                 type: string
 *               pattern:
 *                 type: string
 *               reason:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *               orderNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Datos corregidos exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 tire:
 *                   $ref: '#/components/schemas/Tire'
 *                 previousData:
 *                   type: object
 *                 editedFields:
 *                   type: array
 *                   items:
 *                     type: string
 *                 fieldChanges:
 *                   type: object
 *       400:
 *         description: No se detectaron cambios válidos
 *       404:
 *         description: Cubierta no encontrada
 */
router.patch('/:id/correct', validateTireExists, TireController.correctData);

/**
 * @swagger
 * /api/tires/{id}/history/{historyId}:
 *   patch:
 *     summary: Actualizar una entrada del historial
 *     tags: [Cubiertas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cubierta
 *       - in: path
 *         name: historyId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la entrada del historial
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               form:
 *                 type: object
 *                 properties:
 *                   kmAlta:
 *                     type: number
 *                   kmBaja:
 *                     type: number
 *                   status:
 *                     type: string
 *                   vehicle:
 *                     type: string
 *                   orderNumber:
 *                     type: string
 *                   reason:
 *                     type: string
 *     responses:
 *       200:
 *         description: Historial actualizado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 tire:
 *                   $ref: '#/components/schemas/Tire'
 *                 editedFields:
 *                   type: array
 *                   items:
 *                     type: string
 *                 fieldChanges:
 *                   type: object
 *       400:
 *         description: No se detectaron cambios para corregir
 *       404:
 *         description: Cubierta o entrada de historial no encontrada
 */
router.patch('/:id/history/:historyId', validateTireExists, TireController.updateHistory);

/**
 * @swagger
 * /api/tires/{id}/history/{historyId}/undo:
 *   post:
 *     summary: Deshacer una entrada del historial
 *     tags: [Cubiertas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cubierta
 *       - in: path
 *         name: historyId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la entrada del historial
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderNumber:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Entrada deshecha exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 tire:
 *                   $ref: '#/components/schemas/Tire'
 *                 newEntry:
 *                   $ref: '#/components/schemas/History'
 *                 correctedEntryId:
 *                   type: string
 *       404:
 *         description: Cubierta o entrada de historial no encontrada
 */
router.post('/:id/history/:historyId/undo', validateTireExists, TireController.undoHistoryEntry);

export default router;
