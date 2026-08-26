import TireService from '../services/tire.service.js';
import { getTenantStatuses } from '../services/company.service.js';
import { roleOf } from '../utils/statuses.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';

// Valida que un status pertenezca a los estados configurados del tenant (reemplaza al enum
// fijo que se removió del modelo). Devuelve un mensaje de error o null si es válido.
async function invalidStatus(tenantId, status) {
  const statuses = await getTenantStatuses(tenantId);
  const valid = new Set(statuses.map((s) => s.name));
  return valid.has(status) ? null : `Estado "${status}" no válido para esta empresa.`;
}

// Pre-check de código duplicado, mismo criterio que assertVehicleUnique en vehículos: mensaje
// amable en vez de dejar explotar el índice único, que filtraría el E11000 crudo de Mongo con
// el nombre de la DB del tenant adentro. `field` le dice al front qué campo marcar en rojo.
async function assertTireCodeUnique(db, code) {
  if (code === undefined || code === null) return;
  if (await db.Tire.findOne({ code })) {
    throw httpError(`Ya existe una cubierta con el código ${code}`, 400, 'code');
  }
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
      await assertTireCodeUnique(req.db, req.body.code);
      const tire = await TireService.createTire(req.db, req.body);
      // receiptNumber NO es un path del schema, así que hay que sumarlo a mano: serializar el
      // documento pelado lo perdería y el front no tendría con qué imprimir el comprobante.
      res.status(201).json({ ...tire.toObject(), receiptNumber: tire.receiptNumber });
    } catch (error) {
      // Un error con `status` propio ya trae mensaje de negocio; el resto se loguea y sale
      // como 400 genérico, sin devolverle al cliente el texto interno de Mongo.
      if (error.status) {
        return res.status(error.status).json({ message: error.message, ...(error.field ? { field: error.field } : {}) });
      }
      console.error('Error en create:', error);
      res.status(400).json({ message: 'No se pudo crear la cubierta. Revisá los datos e intentá de nuevo.' });
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
      tire: result.tire,
      receiptNumber: result.receiptNumber
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
    res.status(200).json({ message: 'Cubierta asignada correctamente', tire, receiptNumber: tire.receiptNumber });
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

    // Corregir una entrada puede reescribir el status de la cubierta. Sin este chequeo se podía
    // dejar la cubierta en un estado que NO existe en la config del tenant: roleOf() devuelve
    // undefined, la cubierta se cae de la escalera de recapado, desaparece de los reportes por
    // rol y esquiva el guard de "A recapar". Mismo criterio que create y updateStatus.
    const nuevoStatus = req.body?.form?.status;
    if (nuevoStatus !== undefined && nuevoStatus !== null) {
      const bad = await invalidStatus(req.auth.tenantId, nuevoStatus);
      if (bad) throw httpError(bad, 400, 'status');
    }

    const { tire, ...rest } = await TireService.correctHistoryEntry(req.db, id, historyId, req.body);

    res.status(200).json({ message: 'Historial actualizado correctamente.', tire, ...rest });
  });

  undoHistoryEntry = asyncHandler(async (req, res) => {
    const { id, historyId } = req.params;
    const formData = req.body;

    const { tire, newEntry, correctedEntryId, receiptNumber } = await TireService.undoHistoryEntry(req.db, id, historyId, formData);

    res.status(200).json({
      message: 'Entrada de historial deshecha correctamente.', tire, newEntry, correctedEntryId, receiptNumber
    });
  });
}

export default new TireController();
