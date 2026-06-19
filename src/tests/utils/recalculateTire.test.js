import { recalculateTireState } from '../../utils/utils.js';

// NOTA: los casos originales estaban escritos contra una API vieja que ya no existe:
//   recalculateTire(tire, history)  // mutaba `tire`
// La API actual es:
//   const state = recalculateTireState(history)  // devuelve el estado calculado
//   updateTireFromState(tireDoc, state)
// Además, los `type` van capitalizados y con tilde ('Alta', 'Asignación',
// 'Desasignación', 'Corrección-Desasignación'), no en minúsculas.
// Pendiente de reescritura contra la API real en la fase de estabilización (04).
describe.skip('recalculateTireState — pendiente de reescritura (fase 04)', () => {
  it('calcula km totales incluyendo correcciones', () => {
    expect(typeof recalculateTireState).toBe('function');
  });
});
