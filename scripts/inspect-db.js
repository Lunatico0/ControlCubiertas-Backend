// Solo lectura: inspecciona la DB origen para diseñar el seed de datos falsos.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('Falta MONGO_URI en el .env');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();

const db = client.db(); // usa la DB del connection string
console.log('DB origen:', db.databaseName);

const colls = await db.listCollections().toArray();
for (const c of colls) {
  const coll = db.collection(c.name);
  const count = await coll.countDocuments();
  const sample = await coll.findOne();
  console.log(`\n===== ${c.name} (${count} docs) =====`);
  console.log(JSON.stringify(sample, null, 2));
}

await client.close();
console.log('\n[inspect] listo');
