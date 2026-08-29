// Marca (o desmarca) un tenant como PLANTILLA de la demo.
//
// El tenant plantilla es del que se clona: cuando alguien se loguea con sus credenciales, el
// backend NO lo deja entrar a esa base, le crea un tenant descartable con una copia de los
// datos y lo manda ahí. Ver src/services/demo.service.js.
//
// Sin esto marcado, `admin@andescargo.com` entra a la base compartida como cualquier cliente y
// la leyenda del login queda siendo mentira.
//
// Uso:
//   cd backend && node scripts/marcar-demo.js --db tenant_andes_cargo          (dry-run)
//   cd backend && node scripts/marcar-demo.js --db tenant_andes_cargo --apply
//   cd backend && node scripts/marcar-demo.js --db tenant_andes_cargo --apply --off
//
// ESCRIBE EN EL CONTROL PLANE REAL. Leelo entero y confirmá contra qué tenant apunta.
import { config } from 'dotenv';
import { connectControlPlane, getControlModels, closeControlPlane } from '../src/db/controlPlane.js';

config();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OFF = args.includes('--off');
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const dbName = getArg('--db');
const name = getArg('--name');
if (!dbName && !name) {
  console.error('Falta --db <dbName> o --name "<nombre del tenant>".');
  process.exit(1);
}

await connectControlPlane(process.env.CONTROL_PLANE_URI);
const { Tenant } = getControlModels();

const filtro = dbName ? { dbName } : { name };
const tenant = await Tenant.findOne(filtro);

if (!tenant) {
  console.error(`No existe ningún tenant con ${JSON.stringify(filtro)}.`);
  await closeControlPlane();
  process.exit(1);
}

// Un clon efímero NO puede ser plantilla: se clonaría en cadena y además está por vencer.
if (tenant.demoOf) {
  console.error(`"${tenant.name}" (${tenant.dbName}) es un CLON efímero, no puede ser plantilla.`);
  await closeControlPlane();
  process.exit(1);
}

const destino = !OFF;
console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)'}`);
console.log(`  Tenant: "${tenant.name}" (${tenant.dbName})`);
console.log(`  isDemoTemplate: ${!!tenant.isDemoTemplate} → ${destino}`);

if (APPLY) {
  tenant.isDemoTemplate = destino;
  await tenant.save();
  console.log(destino
    ? '\n✔ Marcado. Los logins contra este tenant ahora reciben un clon descartable de 48 hs.'
    : '\n✔ Desmarcado. Los logins vuelven a entrar a esta base directamente.');
  if (destino) {
    console.log('  Falta setear DEMO_PURGE_SECRET (o CRON_SECRET) en el backend para que la purga corra.');
  }
}

await closeControlPlane();
