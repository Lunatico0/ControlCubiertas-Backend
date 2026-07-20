import TireService from '../services/tire.service.js';
import { getTenantStatuses } from '../services/company.service.js';
import { roleOf } from '../utils/statuses.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Valida que un status pertenezca a los estados configurados del tenant (reemplaza al enum
// fijo que se removió del modelo). Devuelve un mensaje de error o null si es válido.
async function invalidStatus(tenantId, status) {
  const statuses = await getTenantStatuses(tenantId);
  const valid = new Set(statuses.map((s) => s.name));
  return valid.has(status) ? null : `Estado "${status}" no válido para esta empresa.`;
}

class TireController {
  getAll = asyncHandler(async (req, res) => {
    const statuses = await getTenantStatuses(req.auth.tenantId);
    const tires = await TireService.getAll(req.db, statuses);
    res.json(tires);
  });

  getById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const tire = await TireService.getById(req.db, id);
    res.json(tire);
  });

  // Se deja con try/catch a propósito: hoy CUALQUIER error del alta mapea a 400 (createTire
  // tira errores sin status). El middleware central lo llevaría a 500.
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

  updateStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, orderNumber, receiptNumber } = req.body;

    const bad = await invalidStatus(req.auth.tenantId, status);
    if (bad) return res.status(400).json({ message: bad });

    const result = await TireService.updateTireStatus(req.db, id, status, orderNumber, receiptNumber);
    res.status(200).json({
      message: `Estado actualizado de "${result.previousStatus}" a "${status}".`,
      tire: result.tire
    });
  });

  assignVehicle = asyncHandler(async (req, res) => {
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
  });

  unassignVehicle = asyncHandler(async (req, res) => {
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
  });

  correctData = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await TireService.correctData(req.db, id, req.body);
    res.status(200).json({ message: 'Corrección registrada con éxito.', ...result });
  });

  // Se deja con try/catch a propósito: ante un fallo responde un mensaje fijo ("Error al
  // generar número de recibo") en vez de filtrar error.message.
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

  updateHistory = asyncHandler(async (req, res) => {
    const { id, historyId } = req.params;

    const { tire, ...rest } = await TireService.correctHistoryEntry(req.db, id, historyId, req.body);

    res.status(200).json({ message: 'Historial actualizado correctamente.', tire, ...rest });
  });

  undoHistoryEntry = asyncHandler(async (req, res) => {
    const { id, historyId } = req.params;
    const formData = req.body;

    const { tire, newEntry, correctedEntryId } = await TireService.undoHistoryEntry(req.db, id, historyId, formData);

    res.status(200).json({
      message: 'Entrada de historial deshecha correctamente.', tire, newEntry, correctedEntryId
    });
  });
}

export default new TireController();
