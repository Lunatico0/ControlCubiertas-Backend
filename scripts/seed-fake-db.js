// Clona la DB origen a una DB "-Demo" en el mismo cluster, anonimizando datos
// identificables (patentes, móviles, números de serie). Preserva _id y refs.
//
// SEGURIDAD: solo LEE de la DB origen. Solo escribe (y dropea) en la DB destino,
// que debe terminar en "-Demo" y ser distinta de la origen. Si no, aborta.
//
// Uso:  cd backend && node scripts/seed-fake-db.js
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('Falta MONGO_URI en el .env');
  process.exit(1);
}

const DEMO_SUFFIX = '-Demo';

// --- Transformaciones de anonimización ---

// Mezcla de formatos: impares = viejo (ABC-123), pares = Mercosur (AB123CD).
// El número (100 + n) garantiza unicidad y que se note falso.
function fakePlate(n) {
  const num = 100 + n;
  return n % 2 === 1 ? `ABC-${num}` : `AB${num}CD`;
}

const fakeMobile = (n) => `Movil ${String(n).padStart(2, '0')}`;
const fakeSerial = (i) => `SN-${String(i).padStart(4, '0')}`;

async function copyCollection(src, dst, name, transform) {
  const docs = await src.collection(name).find({}).sort({ _id: 1 }).toArray();
  await dst.collection(name).drop().catch(() => {}); // idempotente: limpia destino
  if (docs.length === 0) {
    console.log(`  ${name}: 0 docs (nada que copiar)`);
    return [];
  }
  const out = docs.map((doc, i) => (transform ? transform(doc, i) : doc));
  await dst.collection(name).insertMany(out, { ordered: true });
  console.log(`  ${name}: ${out.length} docs copiados`);
  return out;
}

const client = new MongoClient(uri);
await client.connect();

const srcDb = client.db(); // DB del connection string
const srcName = srcDb.databaseName;
const dstName = srcName + DEMO_SUFFIX;

// --- Candados de seguridad ---
if (dstName === srcName || !dstName.endsWith(DEMO_SUFFIX)) {
  console.error(`ABORT: destino inseguro (origen="${srcName}", destino="${dstName}")`);
  await client.close();
  process.exit(1);
}

const dstDb = client.db(dstName);
console.log(`Origen (solo lectura): ${srcName}`);
console.log(`Destino (se reescribe): ${dstName}\n`);

// vehicles: patente + móvil falsos
const vehicles = await copyCollection(srcDb, dstDb, 'vehicles', (doc, i) => ({
  ...doc,
  mobile: fakeMobile(i + 1),
  licensePlate: fakePlate(i + 1),
}));

// tires: número de serie falso
const tires = await copyCollection(srcDb, dstDb, 'tires', (doc, i) => ({
  ...doc,
  serialNumber: fakeSerial(i + 1),
}));

// histories y receiptcounters: copia íntegra (refs por _id, sin PII)
await copyCollection(srcDb, dstDb, 'histories', null);
await copyCollection(srcDb, dstDb, 'receiptcounters', null);

// --- Verificación ---
console.log('\n[verificación] muestras de la DB destino:');
console.log('  Vehículos (mobile / patente):');
vehicles.slice(0, 6).forEach((v) => console.log(`    ${v.mobile}  ${v.licensePlate}`));
console.log('  Cubiertas (code / serie):');
tires.slice(0, 6).forEach((t) => console.log(`    #${t.code}  ${t.serialNumber}`));

// chequeo de unicidad de patentes y series
const plates = new Set(vehicles.map((v) => v.licensePlate));
const serials = new Set(tires.map((t) => t.serialNumber));
console.log(`\n  Patentes únicas: ${plates.size}/${vehicles.length}`);
console.log(`  Series únicas:   ${serials.size}/${tires.length}`);

await client.close();
console.log('\n[seed] listo. La DB origen NO fue modificada.');
