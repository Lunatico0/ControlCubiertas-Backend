import { generatePositions, AXLE_PRESETS } from '../../utils/axles.js';

// Modelo de ejes: cada eje es 'simple' (2 cubiertas: izq/der) o 'dual' (4: izq/der × ext/int).
// generatePositions deriva las posiciones de neumáticos a partir de la config de ejes.
describe('generatePositions — posiciones de cubiertas por ejes', () => {
  it('eje simple → 2 posiciones (izq, der)', () => {
    const p = generatePositions([{ type: 'simple' }]);
    expect(p.map((x) => x.code)).toEqual(['E1-I', 'E1-D']);
  });

  it('eje dual → 4 posiciones (izq/der, ext/int)', () => {
    const p = generatePositions([{ type: 'dual' }]);
    expect(p.map((x) => x.code)).toEqual(['E1-IE', 'E1-II', 'E1-DI', 'E1-DE']);
  });

  it('camión 4×2 (simple + dual) → 6 posiciones en orden delantero→trasero', () => {
    const p = generatePositions([{ type: 'simple' }, { type: 'dual' }]);
    expect(p).toHaveLength(6);
    expect(p.map((x) => x.code)).toEqual(['E1-I', 'E1-D', 'E2-IE', 'E2-II', 'E2-DI', 'E2-DE']);
  });

  it('sin ejes → lista vacía', () => {
    expect(generatePositions([])).toEqual([]);
    expect(generatePositions()).toEqual([]);
  });

  it('cada posición trae label legible, número de eje y lado', () => {
    const [izq, der] = generatePositions([{ type: 'simple', label: 'Dirección' }]);
    expect(izq).toMatchObject({ code: 'E1-I', label: 'Dirección Izq', axle: 1, side: 'L' });
    expect(der.side).toBe('R');
  });

  it('presets LATAM generan la cantidad de ruedas esperada', () => {
    expect(generatePositions(AXLE_PRESETS.auto.axles)).toHaveLength(4);
    expect(generatePositions(AXLE_PRESETS.camion_4x2.axles)).toHaveLength(6);
    expect(generatePositions(AXLE_PRESETS.camion_6x4.axles)).toHaveLength(10);
    expect(generatePositions(AXLE_PRESETS.bus.axles)).toHaveLength(6);
  });
});
