import { normalizePlate, plateMatcher, PLATE_FORMATS_AR, assertValidPlate, isValidPlate } from '../../utils/plate.js';

// t138 de la auditoría de QA del operario. Reproducido DOBLE:
//
// (a) se aceptó la patente ABC1234XYZ: 10 caracteres, ningún formato argentino, ninguna
//     validación. Un dato así entra a la DB y ya no hay forma de saber si es un error de
//     tipeo o una chapa real.
//
// (b) se creó un vehículo con una patente que YA existía: el original estaba guardado como
//     "ABC-301" (dato legacy, con guion) y el nuevo se normalizó a "ABC301". La query de
//     duplicados busca el valor normalizado y NO encuentra el guionado, así que pasa. En la
//     lista quedan las dos formas conviviendo y buscar "ABC-301" devuelve una sola.
//
// La validación es CONFIGURABLE por tenant: no todo cliente tiene flota argentina, y un
// tenant con chapas extranjeras no puede quedar bloqueado. Lista vacía = no se valida.

describe('normalizePlate (forma canónica)', () => {
  it('lleva a mayúsculas y saca separadores y símbolos', () => {
    expect(normalizePlate('abc-301')).toBe('ABC301');
    expect(normalizePlate('ABC 301')).toBe('ABC301');
    expect(normalizePlate('a b.c/3·0_1')).toBe('ABC301');
  });

  it('tolera nulos', () => {
    expect(normalizePlate(null)).toBe('');
    expect(normalizePlate(undefined)).toBe('');
  });
});

describe('t138 (b) · plateMatcher encuentra los duplicados guardados con separador', () => {
  it('arma una condición que matchea la patente guardada con o sin guion', () => {
    const m = plateMatcher('ABC301');

    // El dato legacy quedó guardado con guion; la forma canónica no lo encuentra por igualdad.
    expect('ABC-301').not.toBe('ABC301');
    // El matcher sí: ignora cualquier separador entre los caracteres significativos.
    expect(m.$regex.test('ABC-301')).toBe(true);
    expect(m.$regex.test('ABC 301')).toBe(true);
    expect(m.$regex.test('abc301')).toBe(true);
    expect(m.$regex.test('ABC301')).toBe(true);
  });

  it('NO matchea una patente distinta ni una que la contenga', () => {
    const m = plateMatcher('ABC301');

    expect(m.$regex.test('ABC302')).toBe(false);
    expect(m.$regex.test('XABC301')).toBe(false);
    expect(m.$regex.test('ABC3012')).toBe(false);
  });

  it('escapa los caracteres especiales en vez de armar un regex roto', () => {
    expect(() => plateMatcher('A.C*30+1')).not.toThrow();
    expect(plateMatcher('A.C*30+1').$regex.test('AC301')).toBe(true);
  });

  it('una patente vacía no matchea todo', () => {
    expect(plateMatcher('').$regex.test('ABC301')).toBe(false);
  });
});

describe('t138 (a) · validación de formato configurable', () => {
  it('el set argentino por defecto acepta las cuatro chapas vigentes', () => {
    expect(isValidPlate('ABC301', PLATE_FORMATS_AR)).toBe(true); // auto viejo AAA000
    expect(isValidPlate('AB123CD', PLATE_FORMATS_AR)).toBe(true); // Mercosur auto AA000AA
    expect(isValidPlate('A123BCD', PLATE_FORMATS_AR)).toBe(true); // Mercosur moto A000AAA
    expect(isValidPlate('123ABC', PLATE_FORMATS_AR)).toBe(true); // moto vieja 000AAA
  });

  it('rechaza la patente del hallazgo: ABC1234XYZ', () => {
    expect(isValidPlate('ABC1234XYZ', PLATE_FORMATS_AR)).toBe(false);
  });

  it('valida sobre la forma NORMALIZADA, no sobre lo tipeado', () => {
    expect(isValidPlate('abc-301', PLATE_FORMATS_AR)).toBe(true);
  });

  it('sin formatos configurados no valida nada: el tenant extranjero no queda bloqueado', () => {
    expect(isValidPlate('ABC1234XYZ', [])).toBe(true);
    expect(isValidPlate('ABC1234XYZ', undefined)).toBe(true);
  });

  it('acepta una máscara propia del tenant escrita con A y 0', () => {
    expect(isValidPlate('XX9999', ['AA0000'])).toBe(true);
    expect(isValidPlate('ABC301', ['AA0000'])).toBe(false);
  });

  it('ignora las máscaras basura en vez de romper', () => {
    expect(isValidPlate('ABC301', ['', null, 'AAA000'])).toBe(true);
  });
});

describe('assertValidPlate (guard de las mutaciones)', () => {
  it('tira 400 con el campo licensePlate cuando el formato no cierra', () => {
    expect.assertions(3);
    try {
      assertValidPlate('ABC1234XYZ', PLATE_FORMATS_AR);
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.field).toBe('licensePlate');
      expect(e.message).toMatch(/formato/i);
    }
  });

  it('devuelve la patente normalizada cuando es válida', () => {
    expect(assertValidPlate('abc-301', PLATE_FORMATS_AR)).toBe('ABC301');
  });

  it('rechaza la patente vacía', () => {
    expect(() => assertValidPlate('', PLATE_FORMATS_AR)).toThrow();
  });
});
