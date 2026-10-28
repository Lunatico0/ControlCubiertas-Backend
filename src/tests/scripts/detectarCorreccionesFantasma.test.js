import { detectarCorreccionesFantasma } from '../../../scripts/detectar-correcciones-fantasma.js';

// M2: solo la función pura de detección. Una "Corrección-Alta" fantasma (S3) es la que se
// escribió y después la cubierta NO se pudo guardar (código duplicado): la cubierta quedó con
// su última actualización ANTERIOR a la entrada.
//
// Ojo: desde el fix de S3 la cubierta se guarda ANTES de escribir la entrada, así que en una
// corrección legítima nueva la cubierta también queda unos milisegundos antes que la entrada.
// Por eso el criterio exige una distancia mínima, y no solo "anterior".

const T0 = new Date('2026-10-20T12:00:00Z');
const seg = (s) => new Date(T0.getTime() + s * 1000);

const entrada = (id, tire, extra = {}) => ({
  _id: id, tire, type: 'Corrección-Alta', editedFields: ['code'], receiptNumber: `0001-0000000${id.length}`,
  createdAt: seg(60), ...extra,
});

describe('detectarCorreccionesFantasma (M2)', () => {
  it('detecta la corrección de código cuya cubierta no se guardó después', () => {
    const cubiertas = new Map([['t1', { _id: 't1', code: 10, updatedAt: T0 }]]);
    const r = detectarCorreccionesFantasma([entrada('h1', 't1')], cubiertas);
    expect(r.fantasmas).toEqual([
      { entrada: 'h1', tire: 't1', code: 10, receiptNumber: '0001-00000002', createdAt: seg(60), editedFields: ['code'] },
    ]);
  });

  it('no marca la corrección legítima: la cubierta se guardó después de la entrada (flujo viejo)', () => {
    const cubiertas = new Map([['t1', { _id: 't1', code: 11, updatedAt: seg(61) }]]);
    expect(detectarCorreccionesFantasma([entrada('h1', 't1')], cubiertas).fantasmas).toEqual([]);
  });

  it('no marca la corrección legítima del flujo nuevo: cubierta guardada milisegundos antes', () => {
    const cubiertas = new Map([['t1', { _id: 't1', code: 11, updatedAt: new Date(seg(60).getTime() - 40) }]]);
    expect(detectarCorreccionesFantasma([entrada('h1', 't1')], cubiertas).fantasmas).toEqual([]);
  });

  it('ignora las que no corrigen el código, las que corrigen otra entrada y las de otro tipo', () => {
    const cubiertas = new Map([['t1', { _id: 't1', code: 10, updatedAt: T0 }]]);
    const r = detectarCorreccionesFantasma([
      entrada('h1', 't1', { editedFields: ['brand'] }),
      entrada('h2', 't1', { corrects: 'hX' }),
      entrada('h3', 't1', { type: 'Corrección-Asignación' }),
    ], cubiertas);
    expect(r.fantasmas).toEqual([]);
  });

  it('separa las entradas cuya cubierta ya no existe (no se puede decidir)', () => {
    const r = detectarCorreccionesFantasma([entrada('h1', 'tX')], new Map());
    expect(r.fantasmas).toEqual([]);
    expect(r.sinCubierta).toEqual([{ entrada: 'h1', tire: 'tX', receiptNumber: '0001-00000002' }]);
  });
});
