import express from 'express';
import { checkOrderExists } from '../controller/order.controller.js';

const router = express.Router();

/**
 * @swagger
 * /api/orders/check/{formattedOrder}:
 *   get:
 *     summary: Verifica si existe una orden con el número formateado
 *     tags: [Órdenes]
 *     parameters:
 *       - in: path
 *         name: formattedOrder
 *         required: true
 *         schema:
 *           type: string
 *         description: Número de orden formateado (ej. 2025-000123)
 *     responses:
 *       200:
 *         description: Orden encontrada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exists:
 *                   type: boolean
 *                 order:
 *                   type: object
 *                   $ref: '#/components/schemas/Order'
 *       404:
 *         description: Orden no encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error del servidor
 */
router.get('/check/:formattedOrder', checkOrderExists);

export default router;
