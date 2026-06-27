import mongoose from 'mongoose';
import { vehicleSchema } from '../../models/vehicle.model.js';
import { tireSchema } from '../../models/tire.model.js';

// Validación de schema PURA (sin DB): se valida el documento con validateSync().
// mongoose.models.X || mongoose.model(...) evita OverwriteModelError si el modelo
// ya fue registrado por el default export.
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', vehicleSchema);
const Tire = mongoose.models.Tire || mongoose.model('Tire', tireSchema);

describe('vehicle schema — ejes y kilometraje', () => {
  it('persiste axles (simple/dual con label) y kilometers', () => {
    const v = new Vehicle({
      brand: 'Scania',
      mobile: 'M1',
      licensePlate: 'AAA111',
      kilometers: 5000,
      axles: [{ type: 'simple' }, { type: 'dual', label: 'Tracción' }],
    });
    expect(v.validateSync()).toBeUndefined();
    expect(v.kilometers).toBe(5000);
    expect(v.axles).toHaveLength(2);
    expect(v.axles[1].type).toBe('dual');
    expect(v.axles[1].label).toBe('Tracción');
  });

  it('kilometers default 0', () => {
    const v = new Vehicle({ brand: 'X', mobile: 'M2', licensePlate: 'AAA112' });
    expect(v.kilometers).toBe(0);
  });

  it('rechaza un type de eje fuera de simple|dual', () => {
    const v = new Vehicle({ brand: 'X', mobile: 'M3', licensePlate: 'AAA113', axles: [{ type: 'triple' }] });
    expect(v.validateSync()).toBeDefined();
  });
});

describe('tire schema — posición montada', () => {
  const base = { status: 'Nueva', code: 1, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN' };

  it('persiste la posición (código de slot del eje)', () => {
    const t = new Tire({ ...base, position: 'E2-DE' });
    expect(t.validateSync()).toBeUndefined();
    expect(t.position).toBe('E2-DE');
  });

  it('position default null (cubierta en depósito)', () => {
    const t = new Tire({ ...base });
    expect(t.validateSync()).toBeUndefined();
    expect(t.position ?? null).toBeNull();
  });
});
