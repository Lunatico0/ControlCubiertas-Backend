// Borra un vehículo de la DB de un tenant, manteniendo el grafo consistente.
//
// Existe para limpiar RESIDUO: vehículos de prueba que quedaron de una sesión de QA o de una
// migración. No es una herramienta de operación diaria — para eso está la app.
//
// Por qué no alcanza un deleteOne a mano (Bug 3 de BUGS.md): no hay back-ref automática en
// Mongoose entre `tire.vehicle` y `vehicle.tires[]`. Borrar el documento suelto deja cubiertas
// montadas en un móvil fantasma, que la app no deja reasignar porque las cree ocupadas.
//
// Lo que hace: desasigna las cubiertas (NO las borra: son inventario real), suelta la ref del
// historial (NO lo reescribe: el movimiento ocurrió) y borra el vehículo.
//
// Uso:
//   cd backend && node scripts/borrar-vehiculo.js --db <dbName> --movil "Móvil 99"
//   cd backend && node scripts/borrar-vehiculo.js --db <dbName> --patente TEST99 --apply
//
// DRY-RUN por defecto: muestra qué cuelga del vehículo y no toca nada. ESCRIBE EN UNA BASE
// REAL con --apply: leelo entero y confirmá contra qué tenant apunta.
import { config } from 'dotenv';
import { initBaseConnection, getTenantDb, closeAll } from '../src/db/tenantConnections.js';
import { inspeccionarVehiculo, borrarVehiculoConsistente } from '../src/services/vehicleCleanup.service.js';

config();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const dbName = getArg('--db');
const mobile = getArg('--movil');
const licensePlate = getArg('--patente');

if (!dbName || (!mobile && !licensePlate)) {
  console.error('Uso: node scripts/borrar-vehiculo.js --db <dbName> (--movil "<móvil>" | --patente <patente>) [--apply]');
  process.exit(1);
}

initBaseConnection(process.env.MONGO_URI);
const { models } = getTenantDb(dbName);
const criterio = mobile ? { mobile } : { licensePlate };

const info = await inspeccionarVehiculo(models, criterio);

if (!info) {
  console.error(`No existe ningún vehículo con ${JSON.stringify(criterio)} en "${dbName}".`);
  await closeAll();
  process.exit(1);
}

console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)'} sobre "${dbName}"\n`);
console.log(`  Vehículo: ${info.vehiculo.mobile} · ${info.vehiculo.licensePlate} · ${info.vehiculo.brand || '—'}`);
console.log(`  Cubiertas montadas: ${info.cubiertasMontadas.length}`);
for (const t of info.cubiertasMontadas) {
  console.log(`    · #${t.code} ${t.serialNumber || ''} en ${t.position || 'sin posición'} (${t.status})  → se DESASIGNA, no se borra`);
}
console.log(`  Entradas de historial que lo referencian: ${info.entradasDeHistorial}  → se conservan, se suelta la ref`);

if (!APPLY) {
  console.log('\nNada se tocó. Volvé a correrlo con --apply si el vehículo de arriba es el que querés borrar.');
} else {
  const r = await borrarVehiculoConsistente(models, criterio);
  console.log(`\n✔ Borrado. Cubiertas desasignadas: ${r.desasignadas}. Entradas de historial limpiadas: ${r.historialLimpiado}.`);
}

await closeAll();
