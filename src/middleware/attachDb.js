import Tire from '../models/tire.model.js';
import Vehicle from '../models/vehicle.model.js';
import History from '../models/history.model.js';
import ReceiptCounter from '../models/receiptCounter.model.js';

// Inyecta los modelos en req.db. HOY (transición mono-tenant) son los modelos globales.
// Cuando llegue el auth multi-tenant (fase 03), este middleware pasará a resolver los
// modelos del tenant vía el connection manager (getTenantDb) según el JWT — SIN tocar
// controllers ni services, que ya consumen req.db.
export function attachDb(req, res, next) {
  req.db = { Tire, Vehicle, History, ReceiptCounter };
  next();
}
