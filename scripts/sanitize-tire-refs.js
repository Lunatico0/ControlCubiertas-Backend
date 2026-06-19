// Saneamiento (Bug 3): quita de vehicle.tires[] las referencias a cubiertas que ya no
// existen (refs colgadas). One-time / mantenimiento. Solo lectura + $set del array limpio.
//
// Uso:  cd backend && node scripts/sanitize-tire-refs.js [dbName]
//   - sin dbName: usa la DB del MONGO_URI.
//   - con dbName: sanea esa DB de tenant (DB-per-tenant).
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

const db = process.argv[2] ? client.db(process.argv[2]) : client.db();
console.log('Saneando:', db.databaseName);

const tireIds = new Set(
  (await db.collection('tires').find({}, { projection: { _id: 1 } }).toArray()).map((t) => String(t._id))
);
const vehicles = await db.collection('vehicles').find({}).toArray();

let vehiclesFixed = 0;
let refsRemoved = 0;

for (const v of vehicles) {
  const current = (v.tires || []).map(String);
  const valid = current.filter((id) => tireIds.has(id));
  if (valid.length !== current.length) {
    await db.collection('vehicles').updateOne({ _id: v._id }, { $set: { tires: valid } });
    vehiclesFixed += 1;
    refsRemoved += current.length - valid.length;
  }
}

console.log(`Vehículos saneados: ${vehiclesFixed} · refs colgadas removidas: ${refsRemoved}`);
await client.close();
