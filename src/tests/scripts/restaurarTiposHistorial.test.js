import { detectarTiposARestaurar } from '../../../scripts/restaurar-tipos-historial.js';

// M5: solo la función pura de detección.
// - S6/S7: corregir o deshacer una entrada la reetiquetaba "Corrección-*" (la ORIGINAL).
//   Se reconoce porque otra entrada la `corrects` y ella misma no corrige a ninguna.
// - N1: un deshacer RECHAZADO marcaba la original igual ("Deshacer entrada", tipo
//   Corrección-*) sin que exista la entrada que la deshace.

const F = (d) => new Date(Date.UTC(2026, 0, d));
const h = (id, tire, type, d, extra = {}) => ({ _id: id, tire, type, date: F(d), createdAt: F(d), editedFields: [], flag: false, ...extra });

describe('detectarTiposARestaurar (M5)', () => {
  it('original reetiquetada por una corrección: propone volver al tipo base y fechar la corrección', () => {
    const r = detectarTiposARestaurar([
      h('a1', 't1', 'Alta', 1),
      h('h1', 't1', 'Corrección-Asignación', 2, { flag: true, reason: 'Corregido en la orden N°5' }),
      h('c1', 't1', 'Corrección-Asignación', 3, { flag: true, corrects: 'h1' }),
    ]);
    expect(r.reetiquetadas).toEqual([{
      entrada: 'h1', tire: 't1', tipoActual: 'Corrección-Asignación', tipoBase: 'Asignación',
      propuesta: { $set: { type: 'Asignación', correctedAt: F(3) } },
    }]);
    expect(r.deshaceresFallidos).toEqual([]);
    expect(r.ambiguas).toEqual([]);
  });

  it('original reetiquetada por un deshacer exitoso: también vuelve al tipo base', () => {
    const r = detectarTiposARestaurar([
      h('a1', 't1', 'Alta', 1),
      h('h2', 't1', 'Corrección-Desasignación', 2, { flag: true, editedFields: ['Deshacer entrada'] }),
      h('g2', 't1', 'Asignación', 3, { flag: true, corrects: 'h2', editedFields: ['Deshacer Desasignación'] }),
    ]);
    expect(r.reetiquetadas.map((x) => [x.entrada, x.tipoBase])).toEqual([['h2', 'Desasignación']]);
    expect(r.deshaceresFallidos).toEqual([]);
  });

  it('deshacer fallido (N1): tipo base, sin marca, sin motivo y sin fecha de corrección', () => {
    const r = detectarTiposARestaurar([
      h('a1', 't1', 'Alta', 1),
      h('h3', 't1', 'Corrección-Estado', 2, {
        flag: true, editedFields: ['Deshacer entrada'], reason: 'Deshecho en la orden N°7',
      }),
    ]);
    expect(r.deshaceresFallidos).toEqual([{
      entrada: 'h3', tire: 't1', tipoActual: 'Corrección-Estado', tipoBase: 'Estado',
      reason: 'Deshecho en la orden N°7',
      propuesta: { $set: { type: 'Estado', flag: false, editedFields: [] }, $unset: { reason: '', correctedAt: '' } },
    }]);
  });

  it('un Alta con un deshacer fallido se reconoce porque la cubierta no tiene otra Alta y es su primera entrada', () => {
    const r = detectarTiposARestaurar([
      h('h4', 't2', 'Corrección-Alta', 1, { flag: true, editedFields: ['Deshacer entrada'], reason: 'Deshecho en la orden N°8' }),
      h('x4', 't2', 'Estado', 2),
    ]);
    expect(r.deshaceresFallidos.map((x) => [x.entrada, x.tipoBase])).toEqual([['h4', 'Alta']]);
  });

  it('una corrección de datos de alta legítima no se toca', () => {
    const r = detectarTiposARestaurar([
      h('a1', 't1', 'Alta', 1),
      h('k1', 't1', 'Corrección-Alta', 2, { flag: true, editedFields: ['brand'], reason: 'tipeo' }),
    ]);
    expect(r).toEqual({ reetiquetadas: [], deshaceresFallidos: [], ambiguas: [] });
  });

  it('una corrección de datos de alta con un deshacer fallido es ambigua: su motivo original se perdió', () => {
    const r = detectarTiposARestaurar([
      h('a1', 't1', 'Alta', 1),
      h('k1', 't1', 'Corrección-Alta', 2, { flag: true, editedFields: ['Deshacer entrada'] }),
    ]);
    expect(r.deshaceresFallidos).toEqual([]);
    expect(r.ambiguas.map((x) => x.entrada)).toEqual(['k1']);
  });

  it('ignora las correcciones genuinas (corrigen a otra) y las originales ya en el formato nuevo', () => {
    const r = detectarTiposARestaurar([
      h('a1', 't1', 'Alta', 1),
      h('o1', 't1', 'Asignación', 2, { flag: true, correctedAt: F(3) }),
      h('c1', 't1', 'Corrección-Asignación', 3, { flag: true, corrects: 'o1' }),
    ]);
    expect(r).toEqual({ reetiquetadas: [], deshaceresFallidos: [], ambiguas: [] });
  });
});
