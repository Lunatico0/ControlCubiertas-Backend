import { getTenantDb } from '../db/tenantConnections.js';

// Los comprobantes no son una colección propia: cada movimiento (History) lleva un
// receiptNumber. El histórico = los movimientos que emitieron comprobante (número real).
const NO_RECEIPT = '0000-00000000';

const escaparRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Histórico de comprobantes del tenant, listo para la tabla del panel y para reimprimir.
// Lee el data plane vía getTenantDb (patrón de stats.service; las rutas admin no tienen attachDb).
//
// El filtrado y la paginación se resuelven ENTEROS en Mongo: History crece monótonamente con
// cada alta, asignación y corrección, y traerlo completo a memoria para hacer slice() revienta
// la lambda de un tenant con años de operación. La búsqueda cross-field (número de comprobante,
// código de cubierta, patente) se resuelve prefiltrando ids en Tire/Vehicle y cruzándolos con
// un $or, que es una query indexada, no un scan.
export async function getTenantReceipts(dbName, { q = '', type = '', page = 1, limit = 20 } = {}) {
  const { History, Tire, Vehicle } = getTenantDb(dbName).models;

  const filter = { receiptNumber: { $ne: NO_RECEIPT } };
  // `type` viene de req.query: el parser qs de Express convierte ?type[$ne]=Alta en un objeto
  // que Mongoose aceptaría como operador. Sólo un string entra al filtro.
  if (typeof type === 'string' && type.trim()) filter.type = type.trim();

  if (q && String(q).trim()) {
    const needle = String(q).trim();
    const rx = new RegExp(escaparRegex(needle), 'i');
    const codigo = Number(needle);

    const [tires, vehicles] = await Promise.all([
      Tire.find(Number.isNaN(codigo) ? { serialNumber: rx } : { code: codigo }).select('_id').lean(),
      Vehicle.find({ licensePlate: rx }).select('_id').lean(),
    ]);

    filter.$or = [
      { receiptNumber: rx },
      ...(tires.length ? [{ tire: { $in: tires.map((t) => t._id) } }] : []),
      ...(vehicles.length ? [{ vehicle: { $in: vehicles.map((v) => v._id) } }] : []),
    ];
  }

  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);

  const [rows, total] = await Promise.all([
    History.find(filter)
      .sort({ date: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate('tire', 'code brand size serialNumber pattern')
      .populate('vehicle', 'licensePlate mobile')
      .lean(),
    History.countDocuments(filter),
  ]);

  const items = rows.map((h) => ({
    id: String(h._id),
    numero: h.receiptNumber,
    fecha: h.date,
    tipo: h.type,
    cubierta: h.tire
      ? { id: String(h.tire._id), code: h.tire.code, brand: h.tire.brand, size: h.tire.size, pattern: h.tire.pattern, serialNumber: h.tire.serialNumber }
      : null,
    patente: h.vehicle?.licensePlate || null,
    movil: h.vehicle?.mobile || null,
    km: h.km ?? null,
    kmAlta: h.kmAlta ?? null,
    kmBaja: h.kmBaja ?? null,
    status: h.status || null,
    orden: h.orderNumber || null,
    usuario: h.editedBy || null,
    // Para reconstruir el comprobante en la reimpresión (correcciones incluidas).
    flag: !!h.flag,
    reason: h.reason || null,
    editedFields: Array.isArray(h.editedFields) ? h.editedFields : [],
  }));

  return { items, total, page: p, limit: l };
}
