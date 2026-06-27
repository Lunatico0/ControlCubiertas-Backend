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

// Rueda única (motos): un solo neumático centrado por eje.
const MOTO_SLOTS = [{ suffix: 'U', side: 'C', label: 'Única' }];

const SLOTS_BY_TYPE = { simple: SIMPLE_SLOTS, dual: DUAL_SLOTS, moto: MOTO_SLOTS };

// axles: [{ type: 'simple'|'dual', label? }] ordenados delantero→trasero.
// Devuelve [{ code, label, axle, side }] — los códigos son E{n}-{slot} (E1-I, E2-DE, …).
export function generatePositions(axles = []) {
  const positions = [];
  (axles || []).forEach((axle, i) => {
    const n = i + 1;
    const slots = SLOTS_BY_TYPE[axle?.type] || SIMPLE_SLOTS;
    const axleLabel = axle?.label || `Eje ${n}`;
    for (const s of slots) {
      positions.push({ code: `E${n}-${s.suffix}`, label: `${axleLabel} ${s.label}`, axle: n, side: s.side });
    }
  });
  return positions;
}

// Mapa de posiciones de un vehículo: cada posición derivada de sus ejes con la cubierta
// montada ahí (subset de campos), o null si está libre. Lo consume el frontend para
// dibujar el esquema del vehículo y ofrecer el selector de posición al montar.
// tires: documentos de cubierta (con .position cuando están montadas).
export function buildVehiclePositions(axles = [], tires = []) {
  const byPos = new Map();
  for (const t of tires || []) {
    if (t?.position) byPos.set(t.position, t);
  }
  return generatePositions(axles).map((p) => {
    const t = byPos.get(p.code);
    return {
      ...p,
      tire: t ? { _id: String(t._id), code: t.code, status: t.status, brand: t.brand } : null,
    };
  });
}

// Presets de las disposiciones más usadas en LATAM (para sugerir en el alta de vehículo).
export const AXLE_PRESETS = {
  auto:       { label: 'Auto / Camioneta',     axles: [{ type: 'simple' }, { type: 'simple' }] },
  camion_4x2: { label: 'Camión 4×2 (reparto)', axles: [{ type: 'simple' }, { type: 'dual' }] },
  camion_6x4: { label: 'Camión 6×4',           axles: [{ type: 'simple' }, { type: 'dual' }, { type: 'dual' }] },
  semi_3:     { label: 'Semirremolque 3 ejes', axles: [{ type: 'dual' }, { type: 'dual' }, { type: 'dual' }] },
  bus:        { label: 'Colectivo / Bus',      axles: [{ type: 'simple' }, { type: 'dual' }] },
  moto:       { label: 'Moto',                 axles: [{ type: 'moto' }, { type: 'moto' }] },
};
