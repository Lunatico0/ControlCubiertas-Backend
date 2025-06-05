import logger from '../config/logger.js';
import { AppError, catchAsync } from '../utils/error-handler.js';
import TireModel from '../models/tire.model.js';
import historyModel from '../models/history.model.js';

// Ejemplo de cómo integrar logging en el servicio de tires
class TireServiceLogged {

  async recalculateTire(tire, history) {
    const startTime = Date.now();
    logger.info('Starting tire recalculation', {
      tireId: tire._id,
      historyEntries: history.length,
      operation: 'recalculateTire'
    });

    try {
      // Tu lógica existente de recalculateTire aquí
      const result = this.performRecalculation(tire, history);

      const duration = Date.now() - startTime;
      logger.info('Tire recalculation completed', {
        tireId: tire._id,
        duration: `${duration}ms`,
        finalStatus: tire.status,
        finalKm: tire.kilometers,
        operation: 'recalculateTire'
      });

      return result;
    } catch (error) {
      logger.logBusinessError('recalculateTire', error, {
        tireId: tire._id,
        historyEntries: history.length,
        duration: `${Date.now() - startTime}ms`
      });
      throw error;
    }
  }

  async undoHistoryEntry(tireId, historyId, formData) {
    logger.logCritical('Undo History Entry Initiated', {
      tireId,
      historyId,
      orderNumber: formData.orderNumber,
      reason: formData.reason
    });

    try {
      const tire = await this.getDocById(tireId);
      const original = await historyModel.findById(historyId);

      if (!original) {
        throw new AppError("Entrada de historial no encontrada", 404);
      }

      logger.info('Undoing history entry', {
        tireId,
        historyId,
        entryType: original.type,
        orderNumber: original.orderNumber,
        operation: 'undoHistoryEntry'
      });

      // Tu lógica existente aquí...
      const result = await this.performUndo(tire, original, formData);

      logger.logCritical('Undo History Entry Completed', {
        tireId,
        historyId,
        newEntryId: result.newEntry?._id,
        revertedTo: result.revertedTo
      });

      return result;
    } catch (error) {
      logger.logBusinessError('undoHistoryEntry', error, {
        tireId,
        historyId,
        formData
      });
      throw error;
    }
  }

  async assignTire(tireId, vehicleId, kmAlta, orderNumber) {
    logger.info('Tire assignment initiated', {
      tireId,
      vehicleId,
      kmAlta,
      orderNumber,
      operation: 'assignTire'
    });

    try {
      // Tu lógica de asignación aquí
      const result = await this.performAssignment(tireId, vehicleId, kmAlta, orderNumber);

      logger.logCritical('Tire Assignment Completed', {
        tireId,
        vehicleId,
        kmAlta,
        orderNumber,
        newHistoryId: result.historyId
      });

      return result;
    } catch (error) {
      logger.logBusinessError('assignTire', error, {
        tireId,
        vehicleId,
        kmAlta,
        orderNumber
      });
      throw error;
    }
  }

  // Método auxiliar para logging de operaciones de DB
  async findTireById(id) {
    try {
      logger.logDB('FIND', 'tires', { id });
      const tire = await TireModel.findById(id);

      if (!tire) {
        logger.warn('Tire not found', { id, operation: 'findTireById' });
        throw new AppError('Cubierta no encontrada', 404);
      }

      return tire;
    } catch (error) {
      logger.logBusinessError('findTireById', error, { id });
      throw error;
    }
  }
}

export default TireServiceLogged;
