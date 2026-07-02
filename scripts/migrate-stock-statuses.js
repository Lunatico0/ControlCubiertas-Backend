// Migra tenant.stockStatuses de [String] legacy a [{name,role}], garantizando estado
// inicial + descartado, y agregando los estados que las cubiertas REALMENTE usan (scan del
// data plane) para no dejar ninguna cubierta con estado "huérfano". Idempotente.
//
// Uso:
//   node scripts/migrate-stock-statuses.js --all     → migra todos los tenants
//   node scripts/migrate-stock-statuses.js --dry      → simula sin escribir (con --all o solo)
//
// Requiere CONTROL_PLANE_URI (tenants) y MONGO_URI (data plane, para el scan de estados en uso).
import { config } from 'dotenv';
import { initBaseConnection, getTenantDb, closeAll } from '../src/db/tenantConnections.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../src/db/controlPlane.js';
import { normalizeStatuses, inferRole } from '../src/utils/statuses.js';

config();

const dry = process.argv.includes('--dry');

if (!process.env.MONGO_URI) {
  console.error('Falta MONGO_URI en el entorno.');
  process.exit(1);
}

await initBaseConnection(process.env.MONGO_URI).asPromise();
await connectControlPlane();

try {
  const { Tenant } = getControlModels();
  // lean(): leer el valor CRUDO de stockStatuses (puede ser [String] legacy) sin que
  // Mongoose intente castearlo al schema nuevo [{name,role}] y pierda los nombres.
  const tenants = await Tenant.find().lean();
  if (!tenants.length) console.log('No hay tenants.');

  for (const tenant of tenants) {
    const before = JSON.stringify(tenant.stockStatuses);
    const statuses = normalizeStatuses(tenant.stockStatuses); // [{name,role}] + initial/discard garantizados
    const knownNames = new Set(statuses.map((s) => s.name));
    const hasRole = (role) => statuses.some((s) => s.role === role);

    // Agregar los estados que las cubiertas usan pero no están en la config (no dejar huérfanas).
    const { Tire } = getTenantDb(tenant.dbName).models;
    const used = await Tire.distinct('status');
    for (const name of used) {
      if (!name || knownNames.has(name)) continue;
      let role = inferRole(name);
      if ((role === 'initial' || role === 'discard' || role === 'recap') && hasRole(role)) role = 'stock';
      statuses.push({ name, role });
      knownNames.add(name);
    }

    // Orden canónico: inicial → escalera (stock, en su orden) → a recapar → baja. Sort estable.
    const ROLE_ORDER = { initial: 0, stock: 1, recap: 2, discard: 3 };
    statuses.sort((a, b) => (ROLE_ORDER[a.role] ?? 1) - (ROLE_ORDER[b.role] ?? 1));

    const changed = before !== JSON.stringify(statuses);
    console.log(`\n=== ${tenant.name} (${tenant.dbName}) ===`);
    console.log(`  estados: ${statuses.map((s) => `${s.name}[${s.role}]`).join(', ')}`);
    console.log(`  ${changed ? (dry ? 'CAMBIARÍA' : 'actualizado') : 'sin cambios'}`);

    if (changed && !dry) {
      await Tenant.updateOne({ _id: tenant._id }, { $set: { stockStatuses: statuses } });
    }
  }
  console.log(`\n----------------------------------------\n=> ${dry ? 'Simulación (dry-run) completa.' : 'Migración completa.'}`);
} finally {
  await closeAll();
  await closeControlPlane();
}
