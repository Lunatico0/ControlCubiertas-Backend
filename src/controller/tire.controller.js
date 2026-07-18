import TireService from '../services/tire.service.js';
import { getTenantStatuses } from '../services/company.service.js';
import { roleOf } from '../utils/statuses.js';

// Valida que un status pertenezca a los estados configurados del tenant (reemplaza al enum
// fijo que se removió del modelo). Devuelve un mensaje de error o null si es válido.
async function invalidStatus(tenantId, status) {
  const statuses = await getTenantStatuses(tenantId);
  const valid = new Set(statuses.map((s) => s.name));
  return valid.has(status) ? null : `Estado "${status}" no válido para esta empresa.`;
}

class TireController {
  async getAll(req, res) {
    try {
      const statuses = await getTenantStatuses(req.auth.tenantId);
      const tires = await TireService.getAll(req.db, statuses);
      res.json(tires);
    } catch (error) {
      console.error('Error en getAll:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const tire = await TireService.getById(req.db, id);
      res.json(tire);
    } catch (error) {
      console.error('Error en getById:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async create(req, res) {
    try {
      const bad = await invalidStatus(req.auth.tenantId, req.body.status);
      if (bad) return res.status(400).json({ message: bad });
      const tire = await TireService.createTire(req.db, req.body);
      res.status(201).json(tire);
    } catch (error) {
      console.error('Error en create:', error);
      res.status(400).json({ message: error.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, orderNumber, receiptNumber } = req.body;

      const bad = await invalidStatus(req.auth.tenantId, status);
      if (bad) return res.status(400).json({ message: bad });

      const result = await TireService.updateTireStatus(req.db, id, status, orderNumber, receiptNumber);
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
      const { vehicle, kmAlta, orderNumber, receiptNumber, position } = req.body;

      if (typeof kmAlta !== 'number') {
        return res.status(400).json({ message: 'Kilómetros de alta (kmAlta) requeridos.' });
      }

      // Guard: una cubierta con rol 'recap' ("A recapar") NO se puede asignar; hay que recaparla
      // primero. El rol se resuelve de los estados configurados del tenant (req.tire lo trae
      // validateTireExists). Fuente de verdad: no depende de que la UI oculte el botón.
      const statuses = await getTenantStatuses(req.auth.tenantId);
      if (roleOf(statuses, req.tire.status) === 'recap') {
        return res.status(409).json({ message: 'La cubierta está "A recapar": recapala antes de asignarla a un vehículo.' });
      }

      const tire = await TireService.assignVehicle(req.db, id, vehicle, kmAlta, orderNumber, receiptNumber, position);
      res.status(200).json({ message: 'Cubierta asignada correctamente', tire });
    } catch (error) {
      console.error('Error en assignVehicle:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async unassignVehicle(req, res) {
    try {
      const { id } = req.params;
      const { kmBaja, orderNumber, receiptNumber } = req.body;

      if (typeof kmBaja !== 'number') {
        return res.status(400).json({ message: 'Kilómetros de baja (kmBaja) requeridos.' });
      }

      const result = await TireService.unassignVehicle(req.db, id, kmBaja, orderNumber, receiptNumber);
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
      const result = await TireService.correctData(req.db, id, req.body);
      res.status(200).json({ message: 'Corrección registrada con éxito.', ...result });
    } catch (error) {
      console.error('Error en correctData:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async getNextReceiptNumber(req, res) {
    try {
      const pointOfSale = 1;

      const counter = await req.db.ReceiptCounter.findOneAndUpdate(
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

      const { tire, ...rest } = await TireService.correctHistoryEntry(req.db, id, historyId, req.body);

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

      const { tire, newEntry, correctedEntryId } = await TireService.undoHistoryEntry(req.db, id, historyId, formData);

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
