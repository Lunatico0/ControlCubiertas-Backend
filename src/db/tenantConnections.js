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
  // Serverless: capturar el fallo del cold start. Si Atlas tarda/hipo en el arranque,
  // el rechazo de la conexión base se logueaba como unhandledRejection (mechanism
  // auto.node.onunhandledrejection en Sentry) y podía 500 la invocación. Con el .catch
  // se loguea y listo; mongoose bufferea las queries y reintenta en la próxima request.
  // Simétrico a como connectControlPlane() ya se maneja con .catch en api/index.js.
  baseConnection.asPromise().catch((err) => console.error('Error conectando al data plane (base):', err.message));
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
