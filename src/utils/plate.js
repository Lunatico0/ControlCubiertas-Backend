// Normaliza una patente a su forma canónica: MAYÚSCULAS y solo letras/números (sin espacios,
// guiones ni símbolos). Así "abc-301", "ABC 301" y "ABC301" son la MISMA patente → el chequeo
// de duplicados no se puede evadir con un guion, y nunca se persisten símbolos.
export const normalizePlate = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
