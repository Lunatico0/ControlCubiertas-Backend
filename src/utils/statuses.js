import { httpError } from './httpError.js';
// Estados de cubierta configurables por tenant. Cada estado tiene un ROL estable que
// sobrevive al renombre, para que la lógica de negocio no dependa del nombre:
//   initial → estado de alta (OBLIGATORIO, exactamente 1)
//   stock   → estados intermedios de la escalera (0..N, libres)
//   recap   → "a recapar": dispara el flujo/señal de recapado (opcional, 0-1)
//   discard → baja definitiva (OBLIGATORIO, exactamente 1)
// La cubierta guarda su status por NOMBRE; el rol se resuelve por lookup en runtime.
export const STATUS_ROLES = ['initial', 'stock', 'recap', 'discard'];

// Heurística SOLO para migrar datos viejos (cuando stockStatuses era [String] sin rol).
// No es lógica de runtime: en runtime el rol viene explícito en la config del tenant.
export function inferRole(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'nueva') return 'initial';
  if (n === 'descartada') return 'discard';
  if (n === 'a recapar') return 'recap';
  return 'stock';
}

// Convierte la config cruda a [{name, role}] y garantiza las invariantes OBLIGATORIAS
// (initial + discard). Tolerante: acepta legacy [String] o [{name,role}] y completa lo
// que falte. NO agrega recap (es opcional). Idempotente sobre un set ya válido.
export function normalizeStatuses(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const list = arr
    .map((s) => (typeof s === 'string'
      ? { name: s, role: inferRole(s) }
      : { name: s?.name, role: s?.role || inferRole(s?.name), ...(s?.color ? { color: s.color } : {}) }))
    .filter((s) => s.name && String(s.name).trim());

  if (!list.some((s) => s.role === 'initial')) {
    if (list.length) list[0].role = 'initial';
    else list.push({ name: 'Nueva', role: 'initial' });
  }
  if (!list.some((s) => s.role === 'discard')) {
    list.push({ name: 'Descartada', role: 'discard' });
  }
  return list;
}

// Valida las invariantes al GUARDAR (estricto, lanza Error con mensaje claro).
export function assertValidStatuses(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw httpError('Debe haber al menos un estado inicial y uno descartado', 400, 'stockStatuses');
  }
  const names = statuses.map((s) => String(s?.name ?? '').trim());
  if (names.some((n) => !n)) throw httpError('Los nombres de estado no pueden estar vacíos', 400, 'stockStatuses');

  const seen = new Set();
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key)) throw httpError(`Nombre de estado duplicado: "${n}"`, 400, 'stockStatuses');
    seen.add(key);
  }

  const count = (role) => statuses.filter((s) => s.role === role).length;
  if (count('initial') !== 1) throw httpError('Debe existir exactamente un estado inicial (nuevo)', 400, 'stockStatuses');
  if (count('discard') !== 1) throw httpError('Debe existir exactamente un estado descartado', 400, 'stockStatuses');
  if (count('recap') > 1) throw httpError('Solo puede haber un estado "a recapar"', 400, 'stockStatuses');
}

// Lookups por rol/nombre.
export function nameByRole(statuses, role) {
  return (statuses || []).find((s) => s.role === role)?.name;
}
export function roleOf(statuses, name) {
  return (statuses || []).find((s) => s.name === name)?.role;
}
