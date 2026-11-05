// Crea el OPERARIO que ofrece el recuadro del login demo en la PLANTILLA (Andes Cargo).
//
// El recuadro (frontend Login.jsx) muestra admin@andescargo.com / operario@andescargo.com con
// la clave pública "tireops", pero el operario no existía en el control plane: el seed crea
// operario1@ y operario2@ con otras claves. Al loguearse, el operario de la plantilla recibe
// una copia efímera igual que el admin (la decisión mira el tenant, no el rol: ver
// services/auth.service.js y tests/demo/demoLoginOperario.api.test.js).
//
// La clave es PÚBLICA a propósito (la muestra el recuadro) y por eso mustChangePassword va
// en false: si quedara obligado, el primer visitante cambiaría la clave compartida.
//
// Uso:
//   cd backend && node scripts/crear-operario-demo.js --db tenant_andes_cargo          (dry-run)
//   cd backend && node scripts/crear-operario-demo.js --db tenant_andes_cargo --apply
//
// ESCRIBE EN EL CONTROL PLANE REAL con --apply. Se niega con un tenant que no sea plantilla
// (isDemoTemplate) o que sea un clon (demoOf). Si el email ya existe, no lo toca: avisa y sale.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const OPERARIO_DEMO = { email: 'operario@andescargo.com', name: 'Operario Demo', password: 'tireops' };

const id = (v) => (v == null ? '' : String(v));

// Función pura: decide qué hacer sin tocar ninguna base.
export function planOperarioDemo(tenant, existente) {
  const no = (motivo) => ({ ok: false, crea: false, motivo });
  if (!tenant) return no('No existe el tenant.');
  if (tenant.demoOf) return no(`"${tenant.dbName}" es un clon efímero de la demo, no la plantilla.`);
  if (!tenant.isDemoTemplate) return no(`"${tenant.dbName}" no es plantilla de demo (isDemoTemplate): este script no toca clientes.`);

  if (existente) {
    const dondeEsta = id(existente.tenantId) === id(tenant._id) ? 'en esta plantilla' : 'en OTRO tenant';
    return { ok: true, crea: false, motivo: `${OPERARIO_DEMO.email} ya existe ${dondeEsta}: no se toca.` };
  }

  return {
    ok: true,
    crea: true,
    usuario: {
      email: OPERARIO_DEMO.email,
      name: OPERARIO_DEMO.name,
      role: 'operator',
      tenantId: tenant._id,
      status: 'active',
      mustChangePassword: false,
    },
  };
}

export async function crearOperarioDemo(User, plan, passwordHash) {
  if (!plan.ok || !plan.crea) return { creado: false };
  await User.create({ ...plan.usuario, passwordHash });
  return { creado: true };
}

async function main() {
  const { config } = await import('dotenv');
  const { connectControlPlane, getControlModels, closeControlPlane } = await import('../src/db/controlPlane.js');
  const { hashPassword, verifyPassword } = await import('../src/services/auth.service.js');
  config();

  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const i = args.indexOf('--db');
  const dbName = i !== -1 ? args[i + 1] : undefined;
  if (!dbName) {
    console.error('Uso: --db <dbName> [--apply]');
    process.exit(1);
  }
  if (!process.env.CONTROL_PLANE_URI) {
    console.error('Falta CONTROL_PLANE_URI en el .env');
    process.exit(1);
  }

  await connectControlPlane(process.env.CONTROL_PLANE_URI);
  try {
    const { Tenant, User } = getControlModels();
    const tenant = await Tenant.findOne({ dbName }).lean();
    const existente = await User.findOne({ email: OPERARIO_DEMO.email }).select('email role tenantId').lean();

    const plan = planOperarioDemo(tenant, existente);
    console.log(APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)');
    if (!plan.ok) {
      console.error(`  Rechazado: ${plan.motivo}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  Tenant: "${tenant.name}" (${tenant.dbName})`);
    if (!plan.crea) {
      console.log(`  ${plan.motivo}`);
      return;
    }
    console.log(`  Crear: ${plan.usuario.email} · rol ${plan.usuario.role} · mustChangePassword false · clave pública del recuadro`);

    if (APPLY) {
      const r = await crearOperarioDemo(User, plan, await hashPassword(OPERARIO_DEMO.password));
      const u = await User.findOne({ email: OPERARIO_DEMO.email }).lean();
      console.log(r.creado ? '\n  Creado.' : '\n  No se creó nada.');
      console.log(`  Verificación: rol ${u?.role}, tenant plantilla ${id(u?.tenantId) === id(tenant._id)}, clave pública válida ${u ? await verifyPassword(OPERARIO_DEMO.password, u.passwordHash) : false}`);
    }
  } finally {
    await closeControlPlane();
  }
}

// Solo corre al invocarlo como script: importarlo (el test de la función pura) no conecta a nada.
const esScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (esScript) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  });
}
