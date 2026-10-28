import { detectarPosicionesColgadas } from '../../../scripts/sanear-posiciones-colgadas.js';

// M3: solo la función pura de detección. El script escribe en bases reales y NO se ejecuta
// en tests.

const V1 = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const V2 = 'aaaaaaaaaaaaaaaaaaaaaaa2';
const vehiculos = new Map([
  [V1, { _id: V1, axles: [{ type: 'simple' }] }], // E1-I, E1-D
  [V2, { _id: V2, axles: [{ type: 'simple' }, { type: 'dual' }] }],
]);

const t = (id, code, vehicle, position) => ({ _id: id, code, vehicle, position });

describe('detectarPosicionesColgadas (M3)', () => {
  it('lista la cubierta en depósito que conserva posición (S7)', () => {
    const r = detectarPosicionesColgadas([t('t1', 1, null, 'E1-D')], vehiculos);
    expect(r.colgadas).toEqual([{ tire: 't1', code: 1, position: 'E1-D' }]);
    expect(r.inexistentes).toEqual([]);
    expect(r.duplicadas).toEqual([]);
  });

  it('ignora las cubiertas sin posición y las montadas en una posición válida', () => {
    const r = detectarPosicionesColgadas([
      t('t1', 1, null, null),
      t('t2', 2, V1, null),
      t('t3', 3, V2, 'E2-DE'),
    ], vehiculos);
    expect(r).toEqual({ colgadas: [], inexistentes: [], duplicadas: [] });
  });

  it('lista la montada en una posición que el vehículo no tiene, o en un vehículo que no existe', () => {
    const r = detectarPosicionesColgadas([
      t('t1', 1, V1, 'E2-DE'),
      t('t2', 2, 'ffffffffffffffffffffffff', 'E1-I'),
    ], vehiculos);
    expect(r.inexistentes.map((x) => x.tire)).toEqual(['t1', 't2']);
    expect(r.inexistentes[0].motivo).toMatch(/ejes/);
    expect(r.inexistentes[1].motivo).toMatch(/no existe/);
    expect(r.colgadas).toEqual([]);
  });

  it('lista dos cubiertas en el mismo vehículo y la misma posición', () => {
    const r = detectarPosicionesColgadas([
      t('t1', 1, V1, 'E1-I'),
      t('t2', 2, V1, 'E1-I'),
      t('t3', 3, V2, 'E1-I'),
    ], vehiculos);
    expect(r.duplicadas).toEqual([
      { vehicle: V1, position: 'E1-I', cubiertas: [{ tire: 't1', code: 1 }, { tire: 't2', code: 2 }] },
    ]);
  });
});
