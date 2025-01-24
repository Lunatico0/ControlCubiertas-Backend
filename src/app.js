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
  res.send('Control cubiertas - Transporte Mario Beltran Cardoso (TMBC) - Backend');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
