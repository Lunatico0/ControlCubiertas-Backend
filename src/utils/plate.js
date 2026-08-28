import { httpError } from './httpError.js';

// Normaliza una patente a su forma canónica: MAYÚSCULAS y solo letras/números (sin espacios,
// guiones ni símbolos). Así "abc-301", "ABC 301" y "ABC301" son la MISMA patente → el chequeo
// de duplicados no se puede evadir con un guion, y nunca se persisten símbolos.
export const normalizePlate = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Escape para meter un literal dentro de un RegExp sin que se interprete como sintaxis.
const escapar = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Condición de Mongo para buscar una patente SIN depender de cómo se guardó (t138).
//
// El chequeo de duplicados comparaba por igualdad contra la forma canónica. Pero en las DBs
// hay filas viejas guardadas CON separador ("ABC-301"): la igualdad no las encuentra y el alta
// de un duplicado pasa. Este matcher tolera cualquier separador entre los caracteres
// significativos y ancla los dos extremos, así "ABC301" encuentra "ABC-301" y "ABC 301" pero
// NO "ABC3012" ni "XABC301".
//
// Es una red de seguridad para el dato legacy, no un reemplazo de la migración: el script
// scripts/migrate-plates.js deja todo en la forma canónica.
export const plateMatcher = (value) => {
  const canonica = normalizePlate(value);
  // Sin patente, un regex vacío matchearía cualquier cosa: se fuerza a no matchear nada.
  if (!canonica) return { $regex: /^(?!)$/ };
  const cuerpo = canonica.split('').map(escapar).join('[^A-Z0-9]*');
  return { $regex: new RegExp(`^[^A-Z0-9]*${cuerpo}[^A-Z0-9]*$`, 'i') };
};

// Formatos de patente vigentes en Argentina, escritos con la convención de máscara del panel:
// A = letra, 0 = dígito. Es el DEFAULT del tenant, no una regla del sistema.
export const PLATE_FORMATS_AR = [
  'AAA000',  // auto, dominio viejo (ABC 301)
  'AA000AA', // auto, Mercosur (AB 123 CD)
  'A000AAA', // moto, Mercosur (A 123 BCD)
  '000AAA',  // moto, dominio viejo (123 ABC)
];

// Compila una máscara ("AA000AA") al regex que la valida sobre la forma canónica.
// Cualquier carácter que no sea A ni 0 se ignora: la máscara describe el formato, no el
// separador (el separador es solo display y se configura aparte, en plateSeparator).
const regexDeMascara = (mascara) => {
  const cuerpo = String(mascara || '')
    .toUpperCase()
    .split('')
    .map((c) => (c === 'A' ? '[A-Z]' : c === '0' ? '[0-9]' : ''))
    .join('');
  return cuerpo ? new RegExp(`^${cuerpo}$`) : null;
};

// ¿La patente cumple ALGUNO de los formatos configurados por el tenant?
//
// Sin formatos configurados NO se valida: hay flotas con chapas extranjeras o históricas, y
// bloquear un alta legítima es peor que aceptar una rara. La lista vacía es la forma explícita
// de decir "acá no valides".
export const isValidPlate = (value, formatos) => {
  const lista = Array.isArray(formatos) ? formatos.map(regexDeMascara).filter(Boolean) : [];
  if (!lista.length) return true;
  const canonica = normalizePlate(value);
  return lista.some((re) => re.test(canonica));
};

// Guard de las mutaciones: valida y DEVUELVE la forma canónica lista para persistir.
export const assertValidPlate = (value, formatos) => {
  const canonica = normalizePlate(value);
  if (!canonica) throw httpError('La patente es obligatoria', 400, 'licensePlate');
  if (!isValidPlate(canonica, formatos)) {
    const ejemplos = (Array.isArray(formatos) ? formatos : []).filter(Boolean).join(', ');
    throw httpError(`La patente no tiene un formato válido${ejemplos ? ` (${ejemplos})` : ''}`, 400, 'licensePlate');
  }
  return canonica;
};
