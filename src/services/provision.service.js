import crypto from 'node:crypto';
import { getControlModels } from '../db/controlPlane.js';
import { getTenantDb } from '../db/tenantConnections.js';
import { hashPassword } from './auth.service.js';

// "Cliente Uno" -> "tenant_cliente_uno"
export function slugifyDbName(name) {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `tenant_${slug}`;
}

// Provisiona un cliente nuevo: registro en el control plane (tenant + admin) y siembra
// su DB de negocio (índices + contador de recibos). Idempotente: aborta si ya existe.
export async function provisionTenant({ name, adminEmail, password, plan = 'free' }) {
  const { User, Tenant } = getControlModels();
  const dbName = slugifyDbName(name);
  const email = adminEmail.toLowerCase().trim();

  if (await Tenant.findOne({ $or: [{ name }, { dbName }] })) {
    throw new Error(`Ya existe un tenant "${name}" (${dbName})`);
  }
  if (await User.findOne({ email })) {
    throw new Error(`El email ${email} ya está registrado`);
  }

  const tempPassword = password || crypto.randomBytes(6).toString('hex');

  const tenant = await Tenant.create({ name, dbName, plan, status: 'active' });
  const user = await User.create({
    email,
    passwordHash: await hashPassword(tempPassword),
    tenantId: tenant._id,
    role: 'tenant-admin',
  });

  // Siembra la DB del tenant: construye índices (unique de code/serial/mobile/placa, etc.)
  // y crea el contador de recibos inicial.
  const { models } = getTenantDb(dbName);
  await Promise.all([
    models.Tire.init(),
    models.Vehicle.init(),
    models.History.init(),
    models.ReceiptCounter.init(),
  ]);
  await models.ReceiptCounter.create({ pointOfSale: 1, currentNumber: 0 });

  return { tenant, user, dbName, tempPassword };
}
