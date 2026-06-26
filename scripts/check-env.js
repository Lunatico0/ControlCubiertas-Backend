// Solo lectura: verifica que CONTROL_PLANE_URI conecte y muestra qué DBs del cluster
// tienen cubiertas (para decidir el dbName del primer tenant).
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const cp = process.env.CONTROL_PLANE_URI;
const dp = process.env.MONGO_URI;
console.log('CONTROL_PLANE_URI seteado:', !!cp);
console.log('MONGO_URI seteado:', !!dp);

if (cp) {
  try {
    const c = new MongoClient(cp);
    await c.connect();
    console.log(`Control plane OK → DB "${c.db().databaseName}"`);
    await c.close();
  } catch (e) {
    console.log('Control plane ERROR:', e.message);
  }
}

if (dp) {
  const c2 = new MongoClient(dp);
  await c2.connect();
  console.log(`Data plane (URI) → DB por defecto "${c2.db().databaseName}"`);
  try {
    const { databases } = await c2.db().admin().listDatabases();
    for (const d of databases) {
      if (['admin', 'local', 'config'].includes(d.name)) continue;
      const tires = await c2.db(d.name).collection('tires').countDocuments().catch(() => '?');
      const vehicles = await c2.db(d.name).collection('vehicles').countDocuments().catch(() => '?');
      console.log(`  DB ${d.name}: ${tires} cubiertas, ${vehicles} vehículos`);
    }
  } catch (e) {
    console.log('  (no se pudo listar DBs:', e.message, ')');
  }
  await c2.close();
}
console.log('[check-env] listo');
