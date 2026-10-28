import { detectarMontadasFueraDeEstado } from '../../../scripts/detectar-montadas-fuera-de-estado.js';

// M4: solo la función pura de detección. Por ROL del tenant: este tenant renombró sus
// estados a propósito ("Para recapar", "Baja").

const ESTADOS = [
  { name: '0 km', role: 'initial' },
  { name: '1er Recapado', role: 'stock' },
  { name: 'Para recapar', role: 'recap' },
  { name: 'Baja', role: 'discard' },
];

const t = (id, code, vehicle, status) => ({ _id: id, code, vehicle, status });

describe('detectarMontadasFueraDeEstado (M4)', () => {
  it('lista las montadas con rol recap o discard', () => {
    const r = detectarMontadasFueraDeEstado([
      t('t1', 1, 'v1', 'Para recapar'),
      t('t2', 2, 'v1', 'Baja'),
      t('t3', 3, 'v1', '1er Recapado'),
      t('t4', 4, null, 'Baja'),
      t('t5', 5, null, 'Para recapar'),
    ], ESTADOS);

    expect(r).toEqual([
      { tire: 't1', code: 1, vehicle: 'v1', status: 'Para recapar', rol: 'recap' },
      { tire: 't2', code: 2, vehicle: 'v1', status: 'Baja', rol: 'discard' },
    ]);
  });

  it('no decide por nombre: "Descartada" sin ese nombre en el tenant no cuenta', () => {
    const r = detectarMontadasFueraDeEstado([t('t1', 1, 'v1', 'Descartada')], ESTADOS);
    expect(r).toEqual([]);
  });
});
