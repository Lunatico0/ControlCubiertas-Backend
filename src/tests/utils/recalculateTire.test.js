import { recalculateTire } from "../../utils/utils.js";

describe('recalculateTire', () => {
  it('debe calcular correctamente el total de kilómetros recorridos incluyendo correcciones', () => {
    const tire = {
      kilometers: 0,
      status: '',
      vehicle: null,
    };

    const history = [
      {
        _id: 'a1',
        type: 'alta',
        status: 'Nueva',
        date: '2024-01-01',
      },
      {
        _id: 'a2',
        type: 'asignacion',
        vehicle: 'veh1',
        kmAlta: 10,
        date: '2024-01-02',
      },
      {
        _id: 'a3',
        type: 'desasignacion',
        vehicle: null,
        kmAlta: 10,
        kmBaja: 20,
        date: '2024-01-03',
      },
      {
        _id: 'a4',
        type: 'correccion-desasignacion',
        corrects: 'a3',
        kmAlta: 10,
        kmBaja: 25,
        date: '2024-01-04',
      },
    ];

    recalculateTire(tire, history);

    expect(tire.kilometers).toBe(15); // 25 - 10, reemplaza los 10 de a3
    expect(tire.status).toBe('Nueva');
    expect(tire.vehicle).toBe(null);
  });
});


describe('recalculateTire', () => {
  it('debe calcular correctamente el total de kilómetros recorridos incluyendo correcciones', () => {
    const tire = {
      kilometers: 0,
      status: '',
      vehicle: null,
    };

    const history = [
      {
        _id: 'a1',
        type: 'alta',
        status: 'Nueva',
        date: '2024-01-01',
      },
      {
        _id: 'a2',
        type: 'asignacion',
        vehicle: 'veh1',
        kmAlta: 10,
        date: '2024-01-02',
      },
      {
        _id: 'a3',
        type: 'desasignacion',
        vehicle: null,
        kmAlta: 10,
        kmBaja: 20,
        date: '2024-01-03',
      },
      {
        _id: 'a4',
        type: 'correccion-desasignacion',
        corrects: 'a3',
        kmAlta: 10,
        kmBaja: 25,
        date: '2024-01-04',
      },
    ];

    recalculateTire(tire, history);

    expect(tire.kilometers).toBe(15); // 25 - 10, reemplaza los 10 de a3
    expect(tire.status).toBe('Nueva');
    expect(tire.vehicle).toBe(null);
  });
});
