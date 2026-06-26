// Alta de un cliente nuevo (Fase 07). Crea tenant + admin en el control plane y siembra
// la DB de negocio del tenant. Requiere CONTROL_PLANE_URI y MONGO_URI en el .env.
//
// Uso:
//   cd backend && node scripts/provision-tenant.js --name "Cliente X" --admin-email admin@x.com [--password secreto]
//   (si no pasás --password, se genera una temporal y se imprime)
import { config } from 'dotenv';
import { connectControlPlane, closeControlPlane } from '../src/db/controlPlane.js';
import { initBaseConnection, closeAll } from '../src/db/tenantConnections.js';
import { provisionTenant } from '../src/services/provision.service.js';

config();

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const name = getArg('--name');
const adminEmail = getArg('--admin-email');
const password = getArg('--password');
const dbName = getArg('--db-name'); // opcional: cutover a una DB existente

if (!name || !adminEmail) {
  console.error('Uso: node scripts/provision-tenant.js --name "Cliente X" --admin-email admin@x.com [--password ...]');
  process.exit(1);
}
if (!process.env.CONTROL_PLANE_URI) {
  console.error('Falta CONTROL_PLANE_URI en el .env');
  process.exit(1);
}

await connectControlPlane();
initBaseConnection(process.env.MONGO_URI);

try {
  const r = await provisionTenant({ name, adminEmail, password, dbName });
  console.log('\n✅ Tenant provisionado:');
  console.log('   Nombre:   ', r.tenant.name);
  console.log('   DB:       ', r.dbName);
  console.log('   Admin:    ', r.user.email);
  console.log('   Password: ', r.tempPassword, '(temporal — cambiar en el primer login)');
} catch (e) {
  console.error('\n❌ Error:', e.message);
  process.exitCode = 1;
} finally {
  await closeControlPlane();
  await closeAll();
}
