import { MongoMemoryServer } from 'mongodb-memory-server';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { inspeccionarVehiculo, borrarVehiculoConsistente } from '../../services/vehicleCleanup.service.js';

// Borrado consistente de un vehículo, para limpiar residuo de QA sin dejar el grafo roto.
//
// El Bug 3 de BUGS.md es explícito: **no hay back-ref automática en Mongoose** entre `tire` y
// `vehicle.tires[]`. Borrar el documento del vehículo a mano deja:
//   - cubiertas con `tire.vehicle` apuntando a un documento que ya no existe,
//   - entradas de historial con `history.vehicle` colgado,
//   - y, si el vehículo tenía cubiertas montadas, cubiertas que la app sigue creyendo montadas
//     en un móvil fantasma (no se pueden asignar a otro lado sin desasignarlas primero).
//
// Por eso esto no es un `deleteOne`. Mantiene los DOS lados a mano, que es lo que el repo
// documenta que hay que hacer.

let mongod;
let db;
const DB = 'tenant_borrado';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  initBaseConnection(mongod.getUri());
  db = getTenantDb(DB).models;
});

afterAll(async () => {
  await closeAll();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([db.Vehicle.deleteMany({}), db.Tire.deleteMany({}), db.History.deleteMany({})]);
});

// Un vehículo con una cubierta montada y su historial, que es el caso peligroso.
const escenario = async () => {
  const veh = await db.Vehicle.create({
    brand: 'Scania', mobile: 'Móvil 99', licensePlate: 'TEST99', axles: [{ type: 'simple' }], tires: [],
  });
  const tire = await db.Tire.create({
    status: 'Nueva', code: 99, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN99',
    vehicle: veh._id, position: 'E1-I',
  });
  veh.tires = [tire._id];
  await veh.save();
  await db.History.create({ tire: tire._id, type: 'Asignación', status: 'Nueva', vehicle: veh._id, date: new Date() });
  return { veh, tire };
};

describe('inspeccionarVehiculo · mirar antes de borrar', () => {
  it('reporta qué cuelga del vehículo, sin tocar nada', async () => {
    const { veh } = await escenario();

    const info = await inspeccionarVehiculo(db, { mobile: 'Móvil 99' });

    expect(info.vehiculo.licensePlate).toBe('TEST99');
    expect(info.cubiertasMontadas).toHaveLength(1);
    expect(info.entradasDeHistorial).toBe(1);
    // Nada se movió: es una inspección.
    expect(await db.Vehicle.findById(veh._id)).not.toBeNull();
    expect((await db.Tire.findOne({ code: 99 })).vehicle).not.toBeNull();
  });

  it('devuelve null si no existe, en vez de explotar', async () => {
    expect(await inspeccionarVehiculo(db, { mobile: 'No existe' })).toBeNull();
  });

  it('encuentra por patente además de por móvil, normalizando el separador', async () => {
    await escenario();

    expect((await inspeccionarVehiculo(db, { licensePlate: 'TEST-99' })).vehiculo.mobile).toBe('Móvil 99');
  });
});

// El caso que casi se lleva puesto un dato real: en las bases hay colisiones de patente (un
// vehículo guardado como "ABC-301" y otro como "ABC301"). `plateMatcher` ignora el separador,
// así que buscar por patente encuentra LOS DOS. Con un findOne, el script elegía uno
// arbitrariamente — o sea que un borrado apuntado al vehículo de prueba podía llevarse el real.
//
// Ante ambigüedad, una herramienta que borra no adivina: se planta.
describe('ambigüedad · no elegir por el usuario', () => {
  it('se niega a borrar si el criterio matchea más de un vehículo', async () => {
    await db.Vehicle.create({ brand: 'X', mobile: 'Real', licensePlate: 'ABC-301', axles: [], tires: [] });
    await db.Vehicle.create({ brand: 'X', mobile: 'Test', licensePlate: 'ABC301', axles: [], tires: [] });

    await expect(borrarVehiculoConsistente(db, { licensePlate: 'ABC301' })).rejects.toThrow(/m[áa]s de un/i);

    // Y lo importante: NO borró ninguno.
    expect(await db.Vehicle.countDocuments()).toBe(2);
  });

  it('la inspección también avisa en vez de mostrar uno solo', async () => {
    await db.Vehicle.create({ brand: 'X', mobile: 'Real', licensePlate: 'ABC-301', axles: [], tires: [] });
    await db.Vehicle.create({ brand: 'X', mobile: 'Test', licensePlate: 'ABC301', axles: [], tires: [] });

    await expect(inspeccionarVehiculo(db, { licensePlate: 'ABC301' })).rejects.toThrow(/m[áa]s de un/i);
  });

  it('el error nombra a los candidatos, para poder desambiguar por móvil', async () => {
    await db.Vehicle.create({ brand: 'X', mobile: 'Real', licensePlate: 'ABC-301', axles: [], tires: [] });
    await db.Vehicle.create({ brand: 'X', mobile: 'Test', licensePlate: 'ABC301', axles: [], tires: [] });

    await expect(borrarVehiculoConsistente(db, { licensePlate: 'ABC301' })).rejects.toThrow(/Real.*Test|Test.*Real/s);
  });

  it('buscar por MÓVIL sigue siendo exacto, aunque las patentes colisionen', async () => {
    await db.Vehicle.create({ brand: 'X', mobile: 'Real', licensePlate: 'ABC-301', axles: [], tires: [] });
    await db.Vehicle.create({ brand: 'X', mobile: 'Test', licensePlate: 'ABC301', axles: [], tires: [] });

    const r = await borrarVehiculoConsistente(db, { mobile: 'Test' });

    expect(r.borrado).toBe(true);
    expect(await db.Vehicle.findOne({ mobile: 'Real' })).not.toBeNull(); // el real intacto
  });
});

describe('borrarVehiculoConsistente · los dos lados del grafo', () => {
  it('desasigna las cubiertas en vez de dejarlas apuntando a un fantasma', async () => {
    await escenario();

    await borrarVehiculoConsistente(db, { mobile: 'Móvil 99' });

    const tire = await db.Tire.findOne({ code: 99 });
    expect(tire).not.toBeNull(); // la CUBIERTA no se borra: es inventario real
    expect(tire.vehicle).toBeNull();
    expect(tire.position).toBeNull(); // si no, queda ocupando una posición que ya no existe
  });

  it('deja el historial sin refs colgadas', async () => {
    await escenario();

    await borrarVehiculoConsistente(db, { mobile: 'Móvil 99' });

    const entradas = await db.History.find();
    expect(entradas).toHaveLength(1); // el movimiento ocurrió: no se reescribe la historia
    expect(entradas[0].vehicle).toBeNull(); // pero la ref al vehículo borrado se limpia
  });

  it('borra el vehículo', async () => {
    await escenario();

    await borrarVehiculoConsistente(db, { mobile: 'Móvil 99' });

    expect(await db.Vehicle.findOne({ mobile: 'Móvil 99' })).toBeNull();
  });

  it('reporta lo que hizo, para poder auditarlo', async () => {
    await escenario();

    const r = await borrarVehiculoConsistente(db, { mobile: 'Móvil 99' });

    expect(r).toMatchObject({ desasignadas: 1, historialLimpiado: 1, borrado: true });
  });

  it('un vehículo sin nada montado se borra igual, sin efectos raros', async () => {
    await db.Vehicle.create({ brand: 'X', mobile: 'Vacío', licensePlate: 'AAA111', axles: [], tires: [] });

    const r = await borrarVehiculoConsistente(db, { mobile: 'Vacío' });

    expect(r).toMatchObject({ desasignadas: 0, historialLimpiado: 0, borrado: true });
  });

  it('no toca las cubiertas de OTRO vehículo', async () => {
    await escenario();
    const otro = await db.Vehicle.create({ brand: 'X', mobile: 'Otro', licensePlate: 'BBB222', axles: [], tires: [] });
    await db.Tire.create({
      status: 'Nueva', code: 100, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN100',
      vehicle: otro._id, position: 'E1-D',
    });

    await borrarVehiculoConsistente(db, { mobile: 'Móvil 99' });

    const ajena = await db.Tire.findOne({ code: 100 });
    expect(String(ajena.vehicle)).toBe(String(otro._id));
    expect(ajena.position).toBe('E1-D');
  });

  it('si el vehículo no existe, no borra nada y lo dice', async () => {
    const r = await borrarVehiculoConsistente(db, { mobile: 'Fantasma' });

    expect(r.borrado).toBe(false);
  });
});
