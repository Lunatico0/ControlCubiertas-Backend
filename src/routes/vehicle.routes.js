import express from 'express';
import VehicleController from '../controller/vehicle.controller.js';
import { validateVehicleExists } from '../middleware/vehicleExists.js';
import vehicleController from '../controller/vehicle.controller.js';

const router = express.Router();

/**
 * @swagger
 * /api/vehicles:
 *   get:
 *     summary: Obtener todos los vehículos
 *     tags: [Vehículos]
 *     responses:
 *       200:
 *         description: Lista de todos los vehículos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Vehicle'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', VehicleController.getAll);

/**
 * @swagger
 * /api/vehicles/{id}:
 *   get:
 *     summary: Obtener un vehículo por ID
 *     tags: [Vehículos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del vehículo
 *     responses:
 *       200:
 *         description: Datos del vehículo con cubiertas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Vehicle'
 *       404:
 *         description: Vehículo no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', VehicleController.getById);

/**
 * @swagger
 * /api/vehicles:
 *   post:
 *     summary: Crear un nuevo vehículo
 *     tags: [Vehículos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - brand
 *               - mobile
 *               - licensePlate
 *             properties:
 *               brand:
 *                 type: string
 *                 description: Marca del vehículo
 *               mobile:
 *                 type: string
 *                 description: Número de móvil único
 *               licensePlate:
 *                 type: string
 *                 description: Patente del vehículo
 *               type:
 *                 type: string
 *                 description: Tipo de vehículo
 *               tires:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array de IDs de cubiertas a asignar
 *     responses:
 *       201:
 *         description: Vehículo creado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Vehicle'
 *       400:
 *         description: Datos inválidos o cubiertas ya asignadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 conflictingTires:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tire'
 */
router.post('/', VehicleController.create);

/**
 * @swagger
 * /api/vehicles/{id}/details:
 *   put:
 *     summary: Actualizar detalles de un vehículo
 *     tags:
 *       - Vehículos
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del vehículo a actualizar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               brand:
 *                 type: string
 *                 description: Marca del vehículo
 *               mobile:
 *                 type: string
 *                 description: Número de móvil (ej. "Movil 10")
 *               licensePlate:
 *                 type: string
 *                 description: Patente del vehículo
 *               type:
 *                 type: string
 *                 description: Tipo de vehículo
 *               tires:
 *                 type: array
 *                 description: IDs de las cubiertas asignadas
 *                 items:
 *                   type: string
 *             required:
 *               - mobile
 *               - licensePlate
 *     responses:
 *       '200':
 *         description: Vehículo actualizado correctamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Vehicle'
 *       '400':
 *         description: Error de validación o cubiertas en conflicto
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 conflictingTires:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tire'
 *       '404':
 *         description: Vehículo no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 */
router.put('/details/:id', validateVehicleExists, vehicleController.updateDetails);

/**
 * @swagger
 * /api/vehicles/{id}:
 *   put:
 *     summary: Actualizar un vehículo
 *     tags: [Vehículos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del vehículo
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               brand:
 *                 type: string
 *               mobile:
 *                 type: string
 *               licensePlate:
 *                 type: string
 *               type:
 *                 type: string
 *               tires:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array de IDs de cubiertas
 *     responses:
 *       200:
 *         description: Vehículo actualizado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Vehicle'
 *       400:
 *         description: Datos inválidos o cubiertas ya asignadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 conflictingTires:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tire'
 *       404:
 *         description: Vehículo no encontrado
 */
router.put('/:id', validateVehicleExists, VehicleController.update);

export default router;
