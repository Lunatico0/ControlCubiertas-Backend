// Migración t138: lleva TODAS las patentes guardadas a la forma canónica (MAYÚSCULAS,
// alfanumérica, sin separadores). Hasta ahora convivían "ABC-301" (dato viejo) y "ABC301"
// (dato nuevo, ya normalizado por el controlador): el chequeo de duplicados por igualdad no
// cruzaba las dos formas y se podían crear DOS vehículos con la misma chapa.
//
// El controlador ya se blindó con plateMatcher (ver utils/plate.js), que ignora separadores,
// así que el duplicado ya no entra ni antes de correr esto. Este script es el que deja los
// datos en un solo formato para que la búsqueda por patente devuelva siempre todo.
//
// Uso:  cd backend && node scripts/migrate-plates.js [dbName ...] [--apply]
//   - sin argumentos: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): migra sólo esas DBs de tenant (DB-per-tenant).
//
// DRY-RUN por defecto: lista lo que haría sin tocar nada; --apply escribe.
//
// COLISIONES: si dos vehículos distintos normalizan a la MISMA patente, el script NO elige
// por vos. Las reporta y NO toca ninguno de los dos, ni siquiera con --apply: decidir cuál
// sobrevive es una decisión de negocio, y el índice único haría fallar el update igual.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const normalizePlate = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

let totalCambios = 0;
let totalColisiones = 0;

for (const dbName of bases) {
  const db = client.db(dbName);
  const vehicles = await db.collection('vehicles')
    .find({}, { projection: { licensePlate: 1, mobile: 1 } })
    .toArray();

  // Índice canónica → vehículos que caen en ella. Más de uno = colisión.
  const porCanonica = new Map();
  for (const v of vehicles) {
    const canonica = normalizePlate(v.licensePlate);
    if (!canonica) continue;
    if (!porCanonica.has(canonica)) porCanonica.set(canonica, []);
    porCanonica.get(canonica).push(v);
  }

  const colisiones = [...porCanonica.entries()].filter(([, vs]) => vs.length > 1);
  const enColision = new Set(colisiones.flatMap(([, vs]) => vs.map((v) => String(v._id))));

  const aCambiar = vehicles.filter(
    (v) => v.licensePlate && normalizePlate(v.licensePlate) !== v.licensePlate && !enColision.has(String(v._id)),
  );

  console.log(`\n[${dbName}] ${vehicles.length} vehículo(s) · ${aCambiar.length} a normalizar · ${colisiones.length} colisión(es)`);

  for (const [canonica, vs] of colisiones) {
    totalColisiones += 1;
    const detalle = vs.map((v) => `${v.mobile || '?'} (${v.licensePlate})`).join(' vs ');
    console.log(`  ⚠ COLISIÓN en "${canonica}": ${detalle} — SIN TOCAR, resolvelo a mano`);
  }

  for (const v of aCambiar) {
    const canonica = normalizePlate(v.licensePlate);
    console.log(`  ${v.mobile || '?'}: "${v.licensePlate}" → "${canonica}"`);
    if (APPLY) {
      await db.collection('vehicles').updateOne({ _id: v._id }, { $set: { licensePlate: canonica } });
    }
    totalCambios += 1;
  }
}

await client.close();
console.log(`\n${APPLY ? 'Aplicados' : 'Pendientes'}: ${totalCambios} cambio(s). Colisiones sin resolver: ${totalColisiones}.`);
if (totalColisiones) process.exitCode = 1;
