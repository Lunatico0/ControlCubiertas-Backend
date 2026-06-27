import { buildVehiclePositions } from '../../utils/axles.js';

// A5: dado los ejes de un vehículo y sus cubiertas, arma el "mapa de posiciones":
// cada posición derivada (E1-I, E2-DE, …) con la cubierta montada ahí, o null si libre.
// Es lo que consume el frontend para el esquema del vehículo y el selector de posición.
describe('buildVehiclePositions(axles, tires)', () => {
  it('embebe la cubierta montada en su posición y deja null las libres', () => {
    const axles = [{ type: 'simple' }]; // → E1-I, E1-D
    const tires = [{ _id: 'abc', code: 7, status: 'Nueva', brand: 'Bridgestone', position: 'E1-I' }];

    const result = buildVehiclePositions(axles, tires);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ code: 'E1-I', tire: { code: 7, status: 'Nueva', brand: 'Bridgestone' } });
    expect(result[0].tire._id).toBe('abc');
    expect(result[1]).toMatchObject({ code: 'E1-D', tire: null });
  });

  it('ignora cubiertas sin posición (en depósito)', () => {
    const axles = [{ type: 'simple' }];
    const tires = [{ _id: 'x', code: 1, status: 'Nueva', position: null }];
    expect(buildVehiclePositions(axles, tires).every((p) => p.tire === null)).toBe(true);
  });

  it('vehículo sin ejes → sin posiciones', () => {
    expect(buildVehiclePositions([], [])).toEqual([]);
    expect(buildVehiclePositions(undefined, undefined)).toEqual([]);
  });

  it('camión 4×2 con dual ocupado parcialmente', () => {
    const axles = [{ type: 'simple' }, { type: 'dual' }]; // 6 posiciones
    const tires = [
      { _id: 'a', code: 10, status: 'Nueva', position: 'E2-IE' },
      { _id: 'b', code: 11, status: '1er Recapado', position: 'E2-DE' },
    ];
    const result = buildVehiclePositions(axles, tires);
    expect(result).toHaveLength(6);
    const occupied = result.filter((p) => p.tire);
    expect(occupied.map((p) => p.code).sort()).toEqual(['E2-DE', 'E2-IE']);
  });
});
