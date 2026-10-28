import crypto from 'node:crypto';
import { getControlModels } from '../db/controlPlane.js';
import { getTenantDb } from '../db/tenantConnections.js';
import { hashPassword } from './auth.service.js';
import { httpError } from '../utils/httpError.js';

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
// su DB de negocio. Idempotente: aborta si ya existe el tenant/email.
//
// `dbName` opcional: si se pasa, el tenant apunta a esa DB (CUTOVER de una DB con datos
// existente). Si no, se deriva del nombre (cliente nuevo). El seed del contador es
// idempotente (no duplica si la DB ya tenía datos).
//
// El admin nace con `mustChangePassword` (A3): la temporal la conoce quien la entregó, y sin
// el flag el admin operaba con ella para siempre. La única excepción es la PLANTILLA de la
// demo (seed-demo-realista.js), cuya clave es pública y compartida: pasa `false`.
// `adminName` opcional (A13-h): nombre del admin, el que firma sus movimientos.
export async function provisionTenant({ name, adminEmail, adminName, password, plan = 'free', dbName, mustChangePassword = true }) {
  const { User, Tenant } = getControlModels();
  const finalDbName = dbName || slugifyDbName(name);
  const email = adminEmail.toLowerCase().trim();

  if (await Tenant.findOne({ $or: [{ name }, { dbName: finalDbName }] })) {
    throw httpError(`Ya existe un tenant "${name}" (${finalDbName})`, 409);
  }
  if (await User.findOne({ email })) {
    throw httpError(`El email ${email} ya está registrado`, 409);
  }

  const tempPassword = password || crypto.randomBytes(6).toString('hex');

  const tenant = await Tenant.create({ name, dbName: finalDbName, plan, status: 'active' });
  const nombre = adminName?.trim();
  const user = await User.create({
    email,
    ...(nombre ? { name: nombre } : {}),
    passwordHash: await hashPassword(tempPassword),
    tenantId: tenant._id,
    role: 'tenant-admin',
    mustChangePassword,
  });

  // Siembra la DB del tenant: índices + contador de recibos (idempotente para soportar
  // cutover de una DB que ya tenía datos).
  const { models } = getTenantDb(finalDbName);
  await Promise.all([
    models.Tire.init(),
    models.Vehicle.init(),
    models.History.init(),
    models.ReceiptCounter.init(),
  ]);
  await models.ReceiptCounter.findOneAndUpdate(
    { pointOfSale: 1 },
    { $setOnInsert: { currentNumber: 0 } },
    { upsert: true }
  );

  return { tenant, user, dbName: finalDbName, tempPassword };
}
