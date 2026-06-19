// Connection manager DB-per-tenant.
//
// Una sola conexión base al cluster; cada tenant es una DB distinta resuelta con
// baseConnection.useDb(dbName). useDb multiplexa todas las DBs sobre el MISMO pool
// de sockets, así N tenants NO abren N pools (clave para no reventar el límite de
// conexiones de Atlas). Los modelos se registran por conexión vía registerModels.
//
// La conexión NUNCA debe guardarse en un singleton de servicio: viaja por request.
import mongoose from 'mongoose';
import { registerModels } from './registerModels.js';

const cache = new Map(); // dbName -> { conn, models }
let baseConnection = null;

export function initBaseConnection(uri, options = {}) {
  baseConnection = mongoose.createConnection(uri, options);
  return baseConnection;
}

export function getBaseConnection() {
  return baseConnection;
}

export function getTenantDb(dbName) {
  const cached = cache.get(dbName);
  if (cached) return cached;

  if (!baseConnection) {
    throw new Error(
      'Conexión base no inicializada. Llamá initBaseConnection(uri) antes de getTenantDb().'
    );
  }

  const conn = baseConnection.useDb(dbName, { useCache: true });
  const models = registerModels(conn);
  const entry = { conn, models };
  cache.set(dbName, entry);
  return entry;
}

export async function closeAll() {
  cache.clear();
  if (baseConnection) {
    await baseConnection.close();
    baseConnection = null;
  }
}
