// Control plane: conexión a la DB central (tenants + users + auth), separada del data
// plane (las DBs de negocio por tenant). Es una conexión propia, independiente del
// connection manager de tenantConnections.js.
import mongoose from 'mongoose';
import { userSchema } from '../models/control/user.schema.js';
import { tenantSchema } from '../models/control/tenant.schema.js';

let controlConn = null;
let models = null;
// Promesa de conexión compartida: evita el race en serverless donde el cold start dispara
// connectControlPlane() (async, no esperado) → controlConn quedaba seteado pero models aún
// null, y una request concurrente veía controlConn "truthy" y devolvía models=null.
let connectPromise = null;

export function registerControlModels(conn) {
  return {
    User: conn.models.User || conn.model('User', userSchema),
    Tenant: conn.models.Tenant || conn.model('Tenant', tenantSchema),
  };
}

export async function connectControlPlane(uri = process.env.CONTROL_PLANE_URI) {
  if (models) return models;
  if (connectPromise) return connectPromise;
  if (!uri) throw new Error('Falta CONTROL_PLANE_URI para el control plane.');
  connectPromise = (async () => {
    controlConn = mongoose.createConnection(uri);
    await controlConn.asPromise();
    models = registerControlModels(controlConn);
    return models;
  })();
  return connectPromise;
}

export function getControlModels() {
  if (!models) {
    throw new Error('Control plane no inicializado. Llamá connectControlPlane() primero.');
  }
  return models;
}

export function getControlConnection() {
  return controlConn;
}

export async function closeControlPlane() {
  if (controlConn) {
    await controlConn.close();
  }
  controlConn = null;
  models = null;
  connectPromise = null;
}
