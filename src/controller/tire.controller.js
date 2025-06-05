import TireService from '../services/tire.service.js';
import receiptCounter from "../models/receiptCounter.model.js";

class TireController {
  async getAll(req, res) {
    try {
      const tires = await TireService.getAll();
      res.json(tires);
    } catch (error) {
      console.error('Error en getAll:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const tire = await TireService.getById(id);
      res.json(tire);
    } catch (error) {
      console.error('Error en getById:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async create(req, res) {
    try {
      const tire = await TireService.createTire(req.body);
      res.status(201).json(tire);
    } catch (error) {
      console.error('Error en create:', error);
      res.status(400).json({ message: error.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, orderNumber } = req.body;

      console.log('id', id)
      console.log('status', status)
      console.log('orderNumber', orderNumber)

      const result = await TireService.updateTireStatus(id, status, orderNumber);
      res.status(200).json({
        message: `Estado actualizado de "${result.previousStatus}" a "${status}".`,
        tire: result.tire
      });
    } catch (error) {
      console.error('Error en updateStatus:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async assignVehicle(req, res) {
    try {
      const { id } = req.params;
      const { vehicle, kmAlta, orderNumber } = req.body;

      if (typeof kmAlta !== 'number') {
        return res.status(400).json({ message: 'Kilómetros de alta (kmAlta) requeridos.' });
      }

      const tire = await TireService.assignVehicle(id, vehicle, kmAlta, orderNumber);
      res.status(200).json({ message: 'Cubierta asignada correctamente', tire });
    } catch (error) {
      console.error('Error en assignVehicle:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async unassignVehicle(req, res) {
    try {
      const { id } = req.params;
      const { kmBaja, orderNumber } = req.body;

      if (typeof kmBaja !== 'number') {
        return res.status(400).json({ message: 'Kilómetros de baja (kmBaja) requeridos.' });
      }

      const result = await TireService.unassignVehicle(id, kmBaja, orderNumber);
      res.status(200).json({
        message: 'Cubierta desasignada con éxito.',
        ...result
      });
    } catch (error) {
      console.error('Error en unassignVehicle:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async correctData(req, res) {
    try {
      const { id } = req.params;
      const result = await TireService.correctData(id, req.body);
      res.status(200).json({ message: 'Corrección registrada con éxito.', ...result });
    } catch (error) {
      console.error('Error en correctData:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async getNextReceiptNumber(req, res) {
    try {
      const pointOfSale = 1;

      const counter = await receiptCounter.findOneAndUpdate(
        { pointOfSale },
        { $inc: { currentNumber: 1 } },
        { new: true, upsert: true }
      );

      const receiptNumber = `${String(pointOfSale).padStart(4, '0')}-${String(counter.currentNumber).padStart(8, '0')}`;
      res.status(200).json({ receiptNumber });
    } catch (err) {
      console.error("Error al obtener número de recibo:", err);
      res.status(500).json({ message: "Error al generar número de recibo" });
    }
  }

  async updateHistory(req, res) {
    try {
      const { id, historyId } = req.params;

      const { tire, ...rest } = await TireService.correctHistoryEntry(id, historyId, req.body);

      res.status(200).json({ message: 'Historial actualizado correctamente.', tire, ...rest });

    } catch (error) {
      console.error('Error en updateHistory:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async undoHistoryEntry(req, res) {
    try {
      const { id, historyId } = req.params;
      const formData = req.body;

      const { tire, newEntry, correctedEntryId } = await TireService.undoHistoryEntry(id, historyId, formData);

      res.status(200).json({
        message: 'Entrada de historial deshecha correctamente.', tire, newEntry, correctedEntryId
      });
    } catch (error) {
      console.error('Error en undoHistoryEntry:', error);
      res.status(500).json({ message: error.message });
    }
  }
}

export default new TireController();
