// Borra UNA cubierta de la PLANTILLA de la demo (Andes Cargo), buscada por número de serie EXACTO.
//
// Existe para sacar residuo de QA de la demo pública: una cubierta cuyo número de serie es un
// string de prueba XSS. No es una herramienta de operación: el producto no borra cubiertas, las
// descarta, y por eso no hay endpoint que reusar.
//
// Grafo (Bug 3 de BUGS.md): no hay back-ref automática entre tire.vehicle, vehicle.tires[] y
// history.tire. El script se NIEGA si la cubierta está montada o si algún vehículo la lista
// (desmontarla es un movimiento real, que se hace desde la app), y si historial de OTRA cubierta
// corrige entradas de esta. Si está suelta, borra primero su historial y después la cubierta:
// si el proceso muere en el medio queda una cubierta sin historial (la próxima corrida la
// borra) y nunca un history.tire apuntando a la nada. Los números de comprobante que usó su
// historial quedan quemados: el contador no retrocede, igual que con cualquier otro hueco.
//
// Uso:
//   cd backend && node scripts/borrar-cubierta-demo.js --db tenant_andes_cargo --serie "<serie exacta>"          (dry-run)
//   cd backend && node scripts/borrar-cubierta-demo.js --db tenant_andes_cargo --serie "<serie exacta>" --apply
//
// ESCRIBE EN UNA BASE REAL con --apply. Se niega con un tenant que no sea plantilla
// (isDemoTemplate) o que sea un clon (demoOf).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Lee lo que cuelga de la cubierta. La serie se compara EXACTA (sin regex ni trim).
export async function inspeccionarCubierta(models, serie) {
  const cubiertas = await models.Tire.find({ serialNumber: serie }).select('_id code status vehicle position').lean();
  if (cubiertas.length !== 1) return { cubiertas, vehiculosQueLaListan: 0, historial: 0, correccionesAjenas: 0 };

  const id = cubiertas[0]._id;
  const propias = await models.History.find({ tire: id }).select('_id').lean();
  const [vehiculosQueLaListan, correccionesAjenas] = await Promise.all([
    models.Vehicle.countDocuments({ tires: id }),
    models.History.countDocuments({ corrects: { $in: propias.map((h) => h._id) }, tire: { $ne: id } }),
  ]);
  return { cubiertas, vehiculosQueLaListan, historial: propias.length, correccionesAjenas };
}

// Función pura: decide qué hacer sin tocar ninguna base.
export function planBorrarCubierta(tenant, info) {
  const no = (motivo) => ({ ok: false, borra: false, motivo });
  if (!tenant) return no('No existe el tenant.');
  if (tenant.demoOf) return no(`"${tenant.dbName}" es un clon efímero de la demo, no la plantilla.`);
  if (!tenant.isDemoTemplate) return no(`"${tenant.dbName}" no es plantilla de demo (isDemoTemplate): este script no toca clientes.`);

  const { cubiertas } = info;
  if (cubiertas.length === 0) return { ok: true, borra: false, motivo: 'No hay ninguna cubierta con esa serie: nada que hacer.' };
  if (cubiertas.length > 1) return no(`La serie matchea más de una cubierta (${cubiertas.length}): no se borra ninguna.`);

  const c = cubiertas[0];
  if (c.vehicle || info.vehiculosQueLaListan > 0) {
    return no(`La cubierta #${c.code} está montada o un vehículo la lista: desmontala desde la app antes.`);
  }
  if (info.correccionesAjenas > 0) {
    return no(`Hay ${info.correccionesAjenas} entrada(s) de historial de otra cubierta que corrigen a esta: revisar a mano.`);
  }
  return { ok: true, borra: true, tireId: c._id, code: c.code, status: c.status, historial: info.historial };
}

export async function borrarCubiertaConsistente(models, plan) {
  if (!plan.ok || !plan.borra) return { cubiertas: 0, historial: 0 };
  // Se re-verifica que siga suelta: el plan pudo quedar viejo.
  const suelta = await models.Tire.findOne({ _id: plan.tireId, vehicle: null }).select('_id').lean();
  if (!suelta || (await models.Vehicle.countDocuments({ tires: plan.tireId })) > 0) return { cubiertas: 0, historial: 0 };

  const h = await models.History.deleteMany({ tire: plan.tireId });
  const t = await models.Tire.deleteOne({ _id: plan.tireId, vehicle: null });
  return { cubiertas: t.deletedCount, historial: h.deletedCount };
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
  const serie = getArg('--serie');
  if (!dbName || !serie) {
    console.error('Uso: --db <dbName> --serie "<serie exacta>" [--apply]');
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
    // Sin tenant plantilla no se abre su base: se rechaza con el plan antes de leer nada.
    const vacio = { cubiertas: [], vehiculosQueLaListan: 0, historial: 0, correccionesAjenas: 0 };
    const esPlantilla = tenant && tenant.isDemoTemplate && !tenant.demoOf;
    const { models } = esPlantilla ? getTenantDb(dbName) : { models: null };
    const info = esPlantilla ? await inspeccionarCubierta(models, serie) : vacio;

    const plan = planBorrarCubierta(tenant, info);
    console.log(APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)');
    if (!plan.ok) {
      console.error(`  Rechazado: ${plan.motivo}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  Tenant: "${tenant.name}" (${tenant.dbName})`);
    if (!plan.borra) {
      console.log(`  ${plan.motivo}`);
      return;
    }
    console.log(`  Cubierta #${plan.code} (${plan.status}), suelta. Entradas de historial a borrar: ${plan.historial}. Vehículos que la listan: 0.`);
    if (APPLY) {
      const r = await borrarCubiertaConsistente(models, plan);
      console.log(`\n  Borradas: ${r.cubiertas} cubierta(s), ${r.historial} entrada(s) de historial.`);
      const resto = await models.Tire.countDocuments({ serialNumber: serie });
      const colgadas = await models.History.countDocuments({ tire: plan.tireId });
      console.log(`  Verificación: cubiertas con esa serie ${resto}, historial apuntando a ella ${colgadas}.`);
    }
  } finally {
    await closeControlPlane();
    await closeAll();
  }
}

// Solo corre al invocarlo como script: importarlo (el test) no conecta a nada.
const esScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (esScript) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  });
}
