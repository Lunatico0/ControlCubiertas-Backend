// Seed de tenants de DEMO: crea varios tenants con sus usuarios (tenant-admin + operator)
// con passwords CONOCIDAS y SIN forzar cambio (mustChangePassword:false), para login
// directo en demos. Idempotente: si el tenant/usuario ya existe, lo respeta (no duplica
// ni pisa passwords). Requiere CONTROL_PLANE_URI y MONGO_URI en el .env.
//
// Uso: cd backend && node scripts/seed-demo.js
import { config } from 'dotenv';
import { connectControlPlane, getControlModels, closeControlPlane } from '../src/db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../src/db/tenantConnections.js';
import { hashPassword } from '../src/services/auth.service.js';
import { slugifyDbName } from '../src/services/provision.service.js';

config();

const DEMO = [
  {
    tenant: 'Transportes del Valle',
    users: [
      { email: 'ana.diaz@delvalle.com',    name: 'Ana Díaz',    role: 'tenant-admin', password: 'ValleAdmin25' },
      { email: 'luis.gomez@delvalle.com',  name: 'Luis Gómez',  role: 'tenant-admin', password: 'ValleAdmin26' },
      { email: 'pedro.ruiz@delvalle.com',  name: 'Pedro Ruiz',  role: 'operator',     password: 'ValleOp01' },
      { email: 'marta.lopez@delvalle.com', name: 'Marta López', role: 'operator',     password: 'ValleOp02' },
      { email: 'jose.sosa@delvalle.com',   name: 'José Sosa',   role: 'operator',     password: 'ValleOp03' },
    ],
  },
  {
    tenant: 'Cargas del Norte',
    users: [
      { email: 'sofia.vega@cargasnorte.com',      name: 'Sofía Vega',      role: 'tenant-admin', password: 'NorteAdmin25' },
      { email: 'diego.mora@cargasnorte.com',      name: 'Diego Mora',      role: 'operator',     password: 'NorteOp01' },
      { email: 'lucia.fernandez@cargasnorte.com', name: 'Lucía Fernández', role: 'operator',     password: 'NorteOp02' },
      { email: 'mateo.silva@cargasnorte.com',     name: 'Mateo Silva',     role: 'operator',     password: 'NorteOp03' },
    ],
  },
];

if (!process.env.CONTROL_PLANE_URI) {
  console.error('Falta CONTROL_PLANE_URI en el .env');
  process.exit(1);
}

await connectControlPlane();
initBaseConnection(process.env.MONGO_URI);

const { User, Tenant } = getControlModels();
const rows = [];

try {
  for (const t of DEMO) {
    const dbName = slugifyDbName(t.tenant);
    let tenant = await Tenant.findOne({ name: t.tenant });
    if (!tenant) {
      tenant = await Tenant.create({ name: t.tenant, dbName, plan: 'free', status: 'active' });
      console.log(`+ Tenant creado:    ${t.tenant} (${dbName})`);
    } else {
      console.log(`= Tenant ya existía: ${t.tenant} (${tenant.dbName})`);
    }

    // Seed mínimo de la DB del tenant: índices + contador de recibos (idempotente).
    const { models } = getTenantDb(tenant.dbName);
    await Promise.all([models.Tire.init(), models.Vehicle.init(), models.History.init(), models.ReceiptCounter.init()]);
    await models.ReceiptCounter.findOneAndUpdate({ pointOfSale: 1 }, { $setOnInsert: { currentNumber: 0 } }, { upsert: true });

    for (const u of t.users) {
      const email = u.email.toLowerCase().trim();
      if (await User.findOne({ email })) {
        console.log(`  = User ya existía: ${email}`);
      } else {
        await User.create({
          email,
          name: u.name,
          role: u.role,
          tenantId: tenant._id,
          passwordHash: await hashPassword(u.password),
          mustChangePassword: false,
          status: 'active',
        });
        console.log(`  + User creado:     ${email} (${u.role})`);
      }
      rows.push({ tenant: t.tenant, email, role: u.role, password: u.password });
    }
  }

  console.log('\n===== USUARIOS DE DEMO (tenant | email | rol | password) =====');
  for (const r of rows) {
    console.log(`${r.tenant}\t${r.email}\t${r.role}\t${r.password}`);
  }
  console.log(`\nTotal: ${rows.length} usuarios en ${DEMO.length} tenants.`);
} catch (e) {
  console.error('\n❌ Error:', e.message);
  process.exitCode = 1;
} finally {
  await closeControlPlane();
  await closeAll();
}
