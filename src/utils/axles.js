// Modelo de ejes/posiciones de cubiertas. Un vehículo se define por sus EJES
// (ordenados delantero→trasero); cada eje es 'simple' (2 cubiertas: izq/der) o
// 'dual' (4: izq/der × externa/interna). De ahí se derivan las POSICIONES de
// neumáticos. Pensado para las disposiciones comunes en LATAM (ver AXLE_PRESETS).

const SIMPLE_SLOTS = [
  { suffix: 'I', side: 'L', label: 'Izq' },
  { suffix: 'D', side: 'R', label: 'Der' },
];

const DUAL_SLOTS = [
  { suffix: 'IE', side: 'L', label: 'Izq ext' },
  { suffix: 'II', side: 'L', label: 'Izq int' },
  { suffix: 'DI', side: 'R', label: 'Der int' },
  { suffix: 'DE', side: 'R', label: 'Der ext' },
];

// axles: [{ type: 'simple'|'dual', label? }] ordenados delantero→trasero.
// Devuelve [{ code, label, axle, side }] — los códigos son E{n}-{slot} (E1-I, E2-DE, …).
export function generatePositions(axles = []) {
  const positions = [];
  (axles || []).forEach((axle, i) => {
    const n = i + 1;
    const slots = axle?.type === 'dual' ? DUAL_SLOTS : SIMPLE_SLOTS;
    const axleLabel = axle?.label || `Eje ${n}`;
    for (const s of slots) {
      positions.push({ code: `E${n}-${s.suffix}`, label: `${axleLabel} ${s.label}`, axle: n, side: s.side });
    }
  });
  return positions;
}

// Presets de las disposiciones más usadas en LATAM (para sugerir en el alta de vehículo).
export const AXLE_PRESETS = {
  auto:       { label: 'Auto / Camioneta',     axles: [{ type: 'simple' }, { type: 'simple' }] },
  camion_4x2: { label: 'Camión 4×2 (reparto)', axles: [{ type: 'simple' }, { type: 'dual' }] },
  camion_6x4: { label: 'Camión 6×4',           axles: [{ type: 'simple' }, { type: 'dual' }, { type: 'dual' }] },
  semi_3:     { label: 'Semirremolque 3 ejes', axles: [{ type: 'dual' }, { type: 'dual' }, { type: 'dual' }] },
  bus:        { label: 'Colectivo / Bus',      axles: [{ type: 'simple' }, { type: 'dual' }] },
};
