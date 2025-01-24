import express from 'express';
import './db.js';
import cors from 'cors';
import { config } from 'dotenv';
import tireRoutes from './routes/tire.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';

config();
const PORT = process.env.PORT || 4000;
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: true }));

app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);

app.get('/', (req, res) => {
  res.send('Hello World!');
});

async function testPopulate() {
  try {
    const vehicles = await vehicleModel.find().populate('tires');
    console.log("Vehículos poblados: ", vehicles);
  } catch (error) {
    console.error("Error al probar populate: ", error.message);
  }
}

testPopulate();

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
