// Genera datos fake coherentes (cubiertas + vehículos + asignaciones) en la DB de un
// tenant, para poblar demos. Datos deterministas (sin azar) y patentes/series falsas.
//
// SEGURIDAD: solo escribe en DBs cuyo nombre empieza con "tenant_" (nunca toca
// Control-Cubiertas / -Demo / -Admin). Dropea tires/vehicles del destino (idempotente).
//
// Uso: cd backend && node scripts/seed-tenant-fake.js --db tenant_xxx --tires 35 --vehicles 14 --offset 200
import { config } from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

config();

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
};

const dbName = arg('--db');
const numTires = parseInt(arg('--tires', '30'), 10);
const numVehicles = parseInt(arg('--vehicles', '12'), 10);
const offset = parseInt(arg('--offset', '0'), 10);

if (!dbName) {
  console.error('Falta --db <tenant_xxx>');
  process.exit(1);
}
if (!dbName.startsWith('tenant_')) {
  console.error(`ABORT: por seguridad solo se siembran DBs "tenant_*" (recibí "${dbName}")`);
  process.exit(1);
}

const TIRE_BRANDS = ['Bridgestone', 'Michelin', 'Pirelli', 'Firestone', 'Goodyear', 'Fate', 'Continental'];
const SIZES = ['295/80 R22.5', '315/80 R22.5', '11R22.5', '275/80 R22.5', '295/75 R22.5'];
const PATTERNS = ['Con Taco', 'Liso', 'Mixto', 'Tracción', 'Direccional'];
// Distribución sesgada (más nuevas/recapados, pocas descartadas) para un dashboard realista.
const STATUS_POOL = ['Nueva', 'Nueva', 'Nueva', '1er Recapado', '1er Recapado', '2do Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada'];
const VEHICLE_BRANDS = ['Scania R450', 'Volvo FH', 'Mercedes Actros', 'Iveco Stralis', 'Ford Cargo', 'Semirremolque Randon', 'Semirremolque Hermann'];

const pick = (arr, n) => arr[((n % arr.length) + arr.length) % arr.length];
const plate = (n) => {
  const num = 100 + offset + n;
  return n % 2 === 1 ? `ABC-${num}` : `AB${num}CD`;
};

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

try {
  const db = client.db(dbName);
  await db.collection('tires').drop().catch(() => {});
  await db.collection('vehicles').drop().catch(() => {});

  // Vehículos
  const vehicles = [];
  for (let i = 1; i <= numVehicles; i++) {
    vehicles.push({
      _id: new ObjectId(),
      mobile: `Movil ${String(i).padStart(2, '0')}`,
      licensePlate: plate(i),
      brand: pick(VEHICLE_BRANDS, i + offset),
      type: null,
      tires: [],
    });
  }

  // Cubiertas (≈55% asignadas a un vehículo → "en circulación"; el resto en depósito)
  const tires = [];
  for (let i = 0; i < numTires; i++) {
    const _id = new ObjectId();
    const assigned = i % 9 < 5 && vehicles.length > 0;
    let vehicle = null;
    if (assigned) {
      const v = vehicles[i % vehicles.length];
      vehicle = v._id;
      v.tires.push(_id);
    }
    const month = i % 12;
    tires.push({
      _id,
      code: 100 + offset + i,
      brand: pick(TIRE_BRANDS, i + offset),
      pattern: pick(PATTERNS, i),
      size: pick(SIZES, i + offset),
      serialNumber: `SN-${String(100 + offset + i).padStart(4, '0')}`,
      status: pick(STATUS_POOL, i),
      kilometers: (i * 1234 + offset * 100) % 300000,
      vehicle,
      createdAt: new Date(2025, month, (i % 27) + 1),
      updatedAt: new Date(2025, month, (i % 27) + 1),
      __v: 0,
    });
  }

  await db.collection('vehicles').insertMany(vehicles);
  await db.collection('tires').insertMany(tires);
  await db.collection('receiptcounters').updateOne(
    { pointOfSale: 1 },
    { $setOnInsert: { pointOfSale: 1, currentNumber: 0 } },
    { upsert: true }
  );

  const enCirculacion = tires.filter((t) => t.vehicle).length;
  const byStatus = {};
  for (const t of tires) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

  console.log(`[seed] ${dbName}: ${tires.length} cubiertas, ${vehicles.length} vehículos`);
  console.log(`  en circulación: ${enCirculacion} · en depósito: ${tires.length - enCirculacion}`);
  console.log(`  por estado: ${JSON.stringify(byStatus)}`);
} catch (e) {
  console.error('❌ Error:', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
