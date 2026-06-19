// Solo lectura: valida integridad referencial. Compara la DB origen vs la "-Demo"
// para distinguir basura preexistente de algo que haya introducido el seed.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

const srcName = client.db().databaseName;

async function checkDb(name) {
  const db = client.db(name);
  const vehicles = await db.collection('vehicles').find({}).toArray();
  const tires = await db.collection('tires').find({}).toArray();
  const histories = await db.collection('histories').find({}).toArray();

  const vehicleIds = new Set(vehicles.map((v) => String(v._id)));
  const tireIds = new Set(tires.map((t) => String(t._id)));

  const tiresColgadas = tires.filter((t) => t.vehicle && !vehicleIds.has(String(t.vehicle)));
  const refsTiresRotas = vehicles.flatMap((v) =>
    (v.tires || []).filter((id) => !tireIds.has(String(id))).map((id) => `${v.mobile} -> ${id}`)
  );
  const histTireRotas = histories.filter((h) => h.tire && !tireIds.has(String(h.tire)));
  const histVehRotas = histories.filter((h) => h.vehicle && !vehicleIds.has(String(h.vehicle)));

  console.log(`\n=== ${name} ===`);
  console.log(`  Cubiertas con vehicle inexistente:   ${tiresColgadas.length}`);
  console.log(`  Refs vehicle.tires[] rotas:          ${refsTiresRotas.length}`);
  console.log(`  Historiales con tire inexistente:    ${histTireRotas.length}`);
  console.log(`  Historiales con vehicle inexistente: ${histVehRotas.length}`);
  return refsTiresRotas.length;
}

const rotasOrigen = await checkDb(srcName);
const rotasDemo = await checkDb(srcName + '-Demo');

console.log('\n----------------------------------------');
console.log(`vehicle.tires[] rotas en ORIGEN: ${rotasOrigen}`);
console.log(`vehicle.tires[] rotas en DEMO:   ${rotasDemo}`);
console.log(
  rotasOrigen === rotasDemo
    ? '=> El seed NO introdujo basura: la demo replica fielmente el origen.'
    : '=> DIFERENCIA: el seed alteró las referencias (revisar).'
);

await client.close();
