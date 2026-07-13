import { config } from 'dotenv';
import app from './app.js';
import { initBaseConnection } from './db/tenantConnections.js';
import { connectControlPlane } from './db/controlPlane.js';

// Arranque LOCAL (npm start / npm run dev). La app (rutas + middleware) es ÚNICA y vive en
// src/app.js. Este archivo SOLO conecta las DBs y hace listen. El entrypoint serverless
// (api/index.js) hace lo análogo. Regla: las rutas se montan en app.js, nunca acá.
config();

const PORT = process.env.PORT || 4000;

initBaseConnection(process.env.MONGO_URI).asPromise().then(async () => {
  console.log('🗄️  Conexión base (data plane) lista');
  if (process.env.CONTROL_PLANE_URI) {
    try {
      await connectControlPlane();
      console.log('🔐 Control plane (auth) conectado');
    } catch (e) {
      console.error('Control plane no disponible:', e.message);
    }
  } else {
    console.warn('⚠️  CONTROL_PLANE_URI no seteado: las rutas /api/auth no funcionarán.');
  }
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📚 Documentación disponible en: http://localhost:${PORT}/api-docs`);
  });
});
