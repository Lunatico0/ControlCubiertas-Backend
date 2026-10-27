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
let baseUri = null;
let baseOptions = {};
// true cuando la conexión INICIAL de la base falló. Mongoose sólo reconecta una conexión que
// ya abrió alguna vez; una que nunca abrió queda muerta y sus queries bufferean hasta el
// timeout. getTenantDb la rearma en la request siguiente.
let baseFallida = false;

export function initBaseConnection(uri, options = {}) {
  baseUri = uri;
  baseOptions = options;
  baseFallida = false;
  const conn = mongoose.createConnection(uri, options);
  baseConnection = conn;
  // Serverless: capturar el fallo del cold start. Sin el .catch, el rechazo se logueaba como
  // unhandledRejection en Sentry y podía 500 la invocación. Simétrico a como
  // connectControlPlane() se maneja con .catch en api/index.js.
  conn.asPromise().catch((err) => {
    console.error('Error conectando al data plane (base):', err.message);
    if (baseConnection === conn) baseFallida = true;
  });
  return conn;
}

// Descarta la conexión base muerta y abre una nueva. Las entradas cacheadas cuelgan de la
// vieja (useDb comparte su cliente), así que se descartan con ella.
function rearmarBase() {
  const muerta = baseConnection;
  cache.clear();
  initBaseConnection(baseUri, baseOptions);
  muerta.close().catch(() => {});
}

export function getBaseConnection() {
  return baseConnection;
}

export function getTenantDb(dbName) {
  if (baseFallida) rearmarBase();
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
  baseFallida = false;
  if (baseConnection) {
    await baseConnection.close();
    baseConnection = null;
  }
}
