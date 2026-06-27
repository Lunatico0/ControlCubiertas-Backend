// Migra tenants al modelo de ejes (utils/axles.js). NO inventa disposiciones: solo
// normaliza defaults (vehicle.kilometers, tire.position) y reporta qué queda por
// configurar (el admin define los ejes de cada vehículo desde la UI). Idempotente.
//
// Uso:
//   node scripts/migrate-axles.js <dbName>     → migra un tenant puntual
//   node scripts/migrate-axles.js --all        → migra todos los tenants del control plane
//
// Requiere MONGO_URI (data plane). Para --all requiere también CONTROL_PLANE_URI.
import { config } from 'dotenv';
import { initBaseConnection, getTenantDb, closeAll } from '../src/db/tenantConnections.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../src/db/controlPlane.js';
import { migrateAxles } from '../src/utils/migrateAxles.js';

config();

const arg = process.argv[2];

if (!arg) {
  console.error('Uso: node scripts/migrate-axles.js <dbName> | --all');
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error('Falta MONGO_URI en el entorno.');
  process.exit(1);
}

function printReport(dbName, r) {
  console.log(`\n=== ${dbName} ===`);
  console.log(`  kilometers backfilled:           ${r.kilometersBackfilled}`);
  console.log(`  position backfilled:             ${r.positionsBackfilled}`);
  console.log(`  vehículos totales:               ${r.vehiclesTotal}`);
  console.log(`  vehículos SIN ejes (a configurar): ${r.vehiclesWithoutAxles}`);
  console.log(`  cubiertas montadas sin posición:   ${r.tiresMountedWithoutPosition}`);
}

async function resolveDbNames() {
  if (arg !== '--all') return [arg];
  await connectControlPlane();
  const tenants = await getControlModels().Tenant.find({}, 'dbName').lean();
  return tenants.map((t) => t.dbName);
}

await initBaseConnection(process.env.MONGO_URI).asPromise();

try {
  const dbNames = await resolveDbNames();
  if (dbNames.length === 0) {
    console.log('No hay tenants para migrar.');
  }
  let pendientes = 0;
  for (const dbName of dbNames) {
    const { models } = getTenantDb(dbName);
    const report = await migrateAxles(models);
    printReport(dbName, report);
    pendientes += report.vehiclesWithoutAxles;
  }
  console.log('\n----------------------------------------');
  console.log(
    pendientes === 0
      ? '=> Listo. Todos los vehículos tienen ejes configurados.'
      : `=> Quedan ${pendientes} vehículo(s) por configurar ejes desde la UI (no se inventó ninguna disposición).`,
  );
} finally {
  await closeAll();
  await closeControlPlane();
}
