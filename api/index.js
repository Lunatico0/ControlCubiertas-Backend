import { config } from 'dotenv';
import app from '../src/app.js';
import { initBaseConnection } from '../src/db/tenantConnections.js';
import { connectControlPlane } from '../src/db/controlPlane.js';

// Entrypoint SERVERLESS (Vercel). La app (rutas + middleware) es ÚNICA y vive en
// src/app.js — este archivo SOLO conecta las DBs en el cold start y exporta el handler.
// El arranque local (npm start) hace lo mismo en src/server.js. No duplicar rutas acá.
config();

// Mongoose bufferea las queries hasta que la conexión esté lista, así las primeras
// requests no fallan. El control plane se re-asegura por-request en app.js (idempotente).
initBaseConnection(process.env.MONGO_URI);
if (process.env.CONTROL_PLANE_URI) {
  connectControlPlane().catch((err) => console.error('Error conectando al control plane:', err));
}

export default app;
