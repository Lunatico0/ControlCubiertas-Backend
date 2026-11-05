// Cambia el prefijo del código interno de cubierta de la PLANTILLA de la demo (Andes Cargo).
//
// La demo pública mostraba los códigos como "#<CLIENTE>-1008": la plantilla tenía cargado
// como prefijo el de un cliente real. El prefijo es SOLO display: vive en
// Tenant.tireCodePrefix (control plane) y el `code` de cada cubierta es un Number
// autoincremental, así que ninguna cubierta, historial ni comprobante guarda el string
// armado. Alcanza con un $set sobre el tenant plantilla; los clones (demo.service.js)
// copian el prefijo al crearse, así que todo login nuevo ya ve el prefijo nuevo.
//
// Uso:
//   cd backend && node scripts/cambiar-prefijo-demo.js --db tenant_andes_cargo --prefix ANC-          (dry-run)
//   cd backend && node scripts/cambiar-prefijo-demo.js --db tenant_andes_cargo --prefix ANC- --apply
//
// ESCRIBE EN EL CONTROL PLANE REAL con --apply. Se niega a correr contra un tenant que no
// sea plantilla de demo (isDemoTemplate) o que sea un clon efímero (demoOf): nunca toca a
// un cliente. Lee las cubiertas de la base del tenant SOLO para mostrar ejemplos y para
// detectar que el código mostrado no se confunda con un número de serie existente.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Misma regla que company.service.js (TIRE_PREFIX_OK) para el panel de Empresa.
const PREFIJO_OK = /^[A-Za-z0-9\-_.\/ ]{0,10}$/;
// Nombres de clientes reales que nunca pueden aparecer en la demo pública.
const PROHIBIDOS = ['TMBC'];

const formatear = (prefijo, code) => `${prefijo ?? ''}${code}`;

// Función pura: decide qué hacer sin tocar ninguna base.
export function planCambioPrefijo(tenant, nuevo, tires = []) {
  const no = (motivo, extra = {}) => ({ ok: false, cambia: false, motivo, ...extra });

  if (!tenant) return no('No existe el tenant.');
  if (tenant.demoOf) return no(`"${tenant.dbName}" es un clon efímero de la demo, no la plantilla.`);
  if (!tenant.isDemoTemplate) return no(`"${tenant.dbName}" no es plantilla de demo (isDemoTemplate): este script no toca clientes.`);
  if (typeof nuevo !== 'string' || !PREFIJO_OK.test(nuevo)) {
    return no('Prefijo inválido: hasta 10 caracteres alfanuméricos o separadores comunes (ej. "T-", "CUB/").');
  }
  if (PROHIBIDOS.some((p) => nuevo.toUpperCase().includes(p))) {
    return no('El prefijo nuevo contiene el nombre de un cliente real.');
  }

  const seriales = new Set(tires.map((t) => String(t.serialNumber ?? '')));
  const colisiones = tires.filter((t) => seriales.has(formatear(nuevo, t.code))).length;
  if (colisiones > 0) {
    return no(`Con "${nuevo}", ${colisiones} código(s) mostrado(s) quedan idénticos a un número de serie existente: elegí otro prefijo.`, { colisiones });
  }

  const antes = tenant.tireCodePrefix ?? '';
  const ejemplos = [...tires]
    .sort((a, b) => a.code - b.code)
    .slice(0, 3)
    .map((t) => ({ antes: formatear(antes, t.code), despues: formatear(nuevo, t.code) }));

  return { ok: true, cambia: antes !== nuevo, antes, despues: nuevo, cubiertas: tires.length, colisiones: 0, ejemplos };
}

// Escribe el plan. El filtro repite la condición de plantilla: aunque alguien le pase un plan
// armado a mano, el update no puede matchear a un cliente real ni a un clon.
export async function aplicarCambioPrefijo(Tenant, tenant, plan) {
  if (!plan.ok || !plan.cambia) return { escrito: false };
  const r = await Tenant.updateOne(
    { _id: tenant._id, isDemoTemplate: true, demoOf: null },
    { $set: { tireCodePrefix: plan.despues } },
  );
  return { escrito: r.modifiedCount === 1 };
}

async function main() {
  const { config } = await import('dotenv');
  const { connectControlPlane, getControlModels, closeControlPlane } = await import('../src/db/controlPlane.js');
  const { initBaseConnection, getTenantDb, closeAll } = await import('../src/db/tenantConnections.js');
  config();

  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
  const dbName = getArg('--db');
  const nuevo = getArg('--prefix');
  if (!dbName || nuevo === undefined) {
    console.error('Uso: --db <dbName> --prefix <prefijo> [--apply]');
    process.exit(1);
  }
  if (!process.env.CONTROL_PLANE_URI || !process.env.MONGO_URI) {
    console.error('Faltan CONTROL_PLANE_URI / MONGO_URI en el .env');
    process.exit(1);
  }

  await connectControlPlane(process.env.CONTROL_PLANE_URI);
  initBaseConnection(process.env.MONGO_URI);
  try {
    const { Tenant } = getControlModels();
    const tenant = await Tenant.findOne({ dbName }).lean();
    const tires = tenant
      ? await getTenantDb(dbName).models.Tire.find().select('code serialNumber').lean()
      : [];

    const plan = planCambioPrefijo(tenant, nuevo, tires);
    console.log(APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)');
    if (!plan.ok) {
      console.error(`  Rechazado: ${plan.motivo}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  Tenant: "${tenant.name}" (${tenant.dbName})`);
    console.log(`  tireCodePrefix: "${plan.antes}" -> "${plan.despues}"`);
    console.log(`  Cubiertas afectadas en pantalla: ${plan.cubiertas} (el code es Number, no se reescribe ninguna)`);
    for (const e of plan.ejemplos) console.log(`    #${e.antes} -> #${e.despues}`);
    if (!plan.cambia) {
      console.log('  Ya tiene ese prefijo: nada que hacer.');
      return;
    }
    if (APPLY) {
      const r = await aplicarCambioPrefijo(Tenant, tenant, plan);
      const leido = await Tenant.findOne({ _id: tenant._id }).select('tireCodePrefix').lean();
      console.log(r.escrito ? '\n  Escrito.' : '\n  No se escribió nada (el tenant dejó de ser plantilla?).');
      console.log(`  Verificación: tireCodePrefix = "${leido?.tireCodePrefix ?? ''}"`);
    }
  } finally {
    await closeControlPlane();
    await closeAll();
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
