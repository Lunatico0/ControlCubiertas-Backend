import { getTenantDb } from '../db/tenantConnections.js';

// Los comprobantes no son una colección propia: cada movimiento (History) lleva un
// receiptNumber. El histórico = los movimientos que emitieron comprobante (número real).
const NO_RECEIPT = '0000-00000000';

// Histórico de comprobantes del tenant, listo para la tabla del panel y para reimprimir.
// Lee el data plane vía getTenantDb (patrón de stats.service; las rutas admin no tienen attachDb).
export async function getTenantReceipts(dbName, { q = '', type = '', page = 1, limit = 20 } = {}) {
  const { History } = getTenantDb(dbName).models;

  const filter = { receiptNumber: { $ne: NO_RECEIPT } };
  if (type) filter.type = type;

  const rows = await History.find(filter)
    .sort({ date: -1 })
    .populate('tire', 'code brand size serialNumber pattern')
    .populate('vehicle', 'licensePlate mobile')
    .lean();

  let items = rows.map((h) => ({
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

  // Búsqueda cross-field (número, código de cubierta, patente): cruza colecciones
  // (History/Tire/Vehicle), así que se filtra en memoria. Se aplica ANTES de paginar
  // para que total y páginas queden coherentes. Volumen por tenant manejable.
  if (q) {
    const needle = q.trim().toLowerCase();
    items = items.filter(
      (c) =>
        c.numero.toLowerCase().includes(needle) ||
        (c.cubierta && String(c.cubierta.code).includes(needle)) ||
        (c.patente && c.patente.toLowerCase().includes(needle)),
    );
  }

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);
  const paged = items.slice((p - 1) * l, p * l);

  return { items: paged, total, page: p, limit: l };
}
