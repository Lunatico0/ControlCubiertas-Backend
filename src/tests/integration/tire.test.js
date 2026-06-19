import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('Flow: Crear, asignar y desasignar cubierta', () => {
  let createdTire;
  let createdVehicle;

  it('debe crear un vehículo', async () => {
    const res = await request(app).post('/api/vehicles').send({
      mobile: 'Movil 99',
      licensePlate: 'ABC-999',
      brand: 'Ford',
      tires: [],
    });

    expect(res.status).toBe(201);
    createdVehicle = res.body;
  });

  it('debe crear una cubierta', async () => {
    const res = await request(app).post('/api/tires').send({
      code: 99,
      brand: 'Michelin',
      pattern: 'Liso',
      serialNumber: 'XYZ999',
      size: '11R22.5',
      status: 'Nueva',
      kilometers: 0,
      createdAt: new Date(),
    });

    expect(res.status).toBe(201);
    createdTire = res.body;
  });

  it('debe asignar la cubierta', async () => {
    const res = await request(app).patch(`/api/tires/${createdTire._id}/assign`).send({
      vehicle: createdVehicle._id,
      kmAlta: 100,
      orderNumber: '000001',
    });

    expect(res.status).toBe(200);
    expect(res.body.tire.vehicle._id).toBe(createdVehicle._id);
  });

  it('debe desasignar la cubierta', async () => {
    const res = await request(app).patch(`/api/tires/${createdTire._id}/unassign`).send({
      kmBaja: 150,
      orderNumber: '000002',
    });

    expect(res.status).toBe(200);
    expect(res.body.kmRecorridos).toBe(50);
  });
});
