// Crea en las DBs de tenant YA EXISTENTES los índices declarados en los modelos del data
// plane. Los tenants nuevos no lo necesitan: provisionTenant llama .init() al aprovisionar.
//
// Es idempotente y SOLO CREA: nunca borra un índice que no esté en el modelo (por eso usa
// createIndexes y no syncIndexes, que sí dropea lo que sobra).
//
// Uso:  cd backend && node scripts/sync-indexes.js [dbName ...]
//   - sin argumentos: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): sólo esas bases.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const INDICES = {
  histories: [
    { key: { tire: 1, date: 1 }, name: 'tire_1_date_1' },
    { key: { type: 1 }, name: 'type_1' },
    { key: { vehicle: 1 }, name: 'vehicle_1' },
    { key: { receiptNumber: 1 }, name: 'receiptNumber_1' },
  ],
  tires: [
    { key: { vehicle: 1 }, name: 'vehicle_1' },
    { key: { status: 1 }, name: 'status_1' },
  ],
};

async function dbNamesDesdeControlPlane() {
  const uri = process.env.CONTROL_PLANE_URI;
  if (!uri) throw new Error('Falta CONTROL_PLANE_URI (o pasá los dbName como argumentos).');
  const cp = new MongoClient(uri);
  await cp.connect();
  const tenants = await cp.db().collection('tenants').find({}, { projection: { dbName: 1, name: 1 } }).toArray();
  await cp.close();
  return tenants.map((t) => t.dbName).filter(Boolean);
}

const explicitos = process.argv.slice(2);
const bases = explicitos.length ? explicitos : await dbNamesDesdeControlPlane();

if (!bases.length) {
  console.log('No hay ninguna base para procesar.');
  process.exit(0);
}

console.log(`Bases a procesar (${bases.length}): ${bases.join(', ')}`);

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

for (const dbName of bases) {
  const db = client.db(dbName);
  for (const [coleccion, specs] of Object.entries(INDICES)) {
    try {
      const res = await db.collection(coleccion).createIndexes(specs);
      console.log(`  ${dbName}.${coleccion}: ${Array.isArray(res) ? res.join(', ') : res}`);
    } catch (err) {
      console.error(`  ${dbName}.${coleccion}: ERROR — ${err.message}`);
    }
  }
}

await client.close();
console.log('Listo.');
