// Saneamiento (Bug 3): quita de vehicle.tires[] las referencias a cubiertas que ya no
// existen (refs colgadas). One-time / mantenimiento. Solo lectura + $set del array limpio.
//
// Uso:  cd backend && node scripts/sanitize-tire-refs.js [dbName ...]
//   - sin argumentos: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): sanea sólo esas DBs de tenant (DB-per-tenant).
//
// Corre en DRY-RUN por defecto: lista lo que haría sin tocar nada. Para escribir de verdad
// hay que pasar --apply. Es un script que ESCRIBE en bases reales: leerlo entero y confirmar
// contra qué tenant apunta antes de cada corrida.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const explicitos = args.filter((a) => !a.startsWith('--'));

async function dbNamesDesdeControlPlane() {
  const uri = process.env.CONTROL_PLANE_URI;
  if (!uri) throw new Error('Falta CONTROL_PLANE_URI (o pasá los dbName como argumentos).');
  const cp = new MongoClient(uri);
  await cp.connect();
  const tenants = await cp.db().collection('tenants').find({}, { projection: { dbName: 1 } }).toArray();
  await cp.close();
  return tenants.map((t) => t.dbName).filter(Boolean);
}

const bases = explicitos.length ? explicitos : await dbNamesDesdeControlPlane();
console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)'} sobre ${bases.length} base(s): ${bases.join(', ')}`);

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

let totalVehiculos = 0;
let totalRefs = 0;

for (const dbName of bases) {
  const db = client.db(dbName);
  const tireIds = new Set(
    (await db.collection('tires').find({}, { projection: { _id: 1 } }).toArray()).map((t) => String(t._id)),
  );
  const vehicles = await db.collection('vehicles').find({}).toArray();

  let vehiclesFixed = 0;
  let refsRemoved = 0;

  for (const v of vehicles) {
    const current = (v.tires || []).map(String);
    const valid = current.filter((id) => tireIds.has(id));
    if (valid.length !== current.length) {
      if (APPLY) {
        await db.collection('vehicles').updateOne({ _id: v._id }, { $set: { tires: valid } });
      }
      vehiclesFixed += 1;
      refsRemoved += current.length - valid.length;
    }
  }

  console.log(`  ${dbName}: ${vehiclesFixed} vehículo(s) · ${refsRemoved} ref(s) colgada(s)`);
  totalVehiculos += vehiclesFixed;
  totalRefs += refsRemoved;
}

console.log(`Total: ${totalVehiculos} vehículo(s) · ${totalRefs} ref(s) colgada(s)${APPLY ? ' removidas' : ' detectadas'}`);
await client.close();
