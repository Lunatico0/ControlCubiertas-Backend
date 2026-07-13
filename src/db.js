import mongoose from 'mongoose';
import { config } from 'dotenv';

config();

mongoose.set('strictPopulate', false);

// Conexión perezosa: se invoca explícitamente desde el bootstrap (server.js /
// api/index.js) o desde los tests (apuntando a mongodb-memory-server). Importar este
// módulo ya NO abre una conexión — eso desacopla el arranque y permite testear aislado
// sin pegar a Atlas.
export async function connectMongo(uri = process.env.MONGO_URI) {
  await mongoose.connect(uri);
  console.log('Conexión a MongoDB exitosa');
  return mongoose.connection;
}

export default connectMongo;
