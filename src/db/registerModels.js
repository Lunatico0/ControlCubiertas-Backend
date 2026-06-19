// Registra los 4 modelos de negocio sobre una conexión Mongoose dada.
// Usado por el connection manager para tener modelos POR conexión (DB-per-tenant)
// en vez de modelos globales. Invariante: los 4 se registran juntos sobre la MISMA
// conexión, para que los populate (Tire->Vehicle, Vehicle->Tire, History->*) resuelvan
// sus refs dentro de esa conexión y no tiren MissingSchemaError.
import { tireSchema } from '../models/tire.model.js';
import { vehicleSchema } from '../models/vehicle.model.js';
import { historySchema } from '../models/history.model.js';
import { receiptCounterSchema } from '../models/receiptCounter.model.js';

export function registerModels(conn) {
  return {
    Tire: conn.models.Tire || conn.model('Tire', tireSchema),
    Vehicle: conn.models.Vehicle || conn.model('Vehicle', vehicleSchema),
    History: conn.models.History || conn.model('History', historySchema),
    ReceiptCounter:
      conn.models.ReceiptCounter || conn.model('ReceiptCounter', receiptCounterSchema),
  };
}
