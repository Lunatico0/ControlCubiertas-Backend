import { planCambioPrefijo, aplicarCambioPrefijo } from '../../../scripts/cambiar-prefijo-demo.js';

// La plantilla de la demo pública (Andes Cargo) mostraba los códigos de cubierta con el prefijo
// de un cliente real. El prefijo es SOLO display: vive en Tenant.tireCodePrefix (control plane)
// y el `code` de la cubierta es un Number, así que el cambio es un $set sobre el tenant.
// Lo que se prueba: el plan (qué cambia, idempotencia, a qué bases se niega) y que el apply
// escribe sólo sobre la plantilla.

const PLANTILLA = { _id: 't1', name: 'Andes Cargo', dbName: 'tenant_andes_cargo', isDemoTemplate: true, tireCodePrefix: 'VIEJO-' };
const TIRES = [
  { code: 1001, serialNumber: 'AC-1001' },
  { code: 1002, serialNumber: 'AC-1002' },
];

describe('planCambioPrefijo', () => {
  it('cambia el prefijo de la plantilla y muestra antes/después de los códigos', () => {
    const p = planCambioPrefijo(PLANTILLA, 'ANC-', TIRES);
    expect(p.ok).toBe(true);
    expect(p.cambia).toBe(true);
    expect(p.antes).toBe('VIEJO-');
    expect(p.despues).toBe('ANC-');
    expect(p.ejemplos[0]).toEqual({ antes: 'VIEJO-1001', despues: 'ANC-1001' });
    expect(p.cubiertas).toBe(2);
  });

  it('es idempotente: si ya tiene el prefijo nuevo, no cambia nada', () => {
    const p = planCambioPrefijo({ ...PLANTILLA, tireCodePrefix: 'ANC-' }, 'ANC-', TIRES);
    expect(p.ok).toBe(true);
    expect(p.cambia).toBe(false);
  });

  it('se niega a tocar una base que no es plantilla de demo (un cliente real)', () => {
    const p = planCambioPrefijo({ ...PLANTILLA, isDemoTemplate: false }, 'ANC-', TIRES);
    expect(p.ok).toBe(false);
    expect(p.motivo).toMatch(/plantilla/i);
  });

  it('se niega a tocar un clon efímero (demoOf), aunque herede la marca', () => {
    const p = planCambioPrefijo({ ...PLANTILLA, demoOf: 't1' }, 'ANC-', TIRES);
    expect(p.ok).toBe(false);
  });

  it('se niega si el tenant no existe', () => {
    expect(planCambioPrefijo(null, 'ANC-', TIRES).ok).toBe(false);
  });

  it('rechaza un prefijo inválido (misma regla que el panel de Empresa)', () => {
    expect(planCambioPrefijo(PLANTILLA, 'DEMASIADOLARGO', TIRES).ok).toBe(false);
    expect(planCambioPrefijo(PLANTILLA, 'A*B', TIRES).ok).toBe(false);
  });

  it('rechaza un prefijo que vuelva a mostrar el nombre del cliente', () => {
    const p = planCambioPrefijo(PLANTILLA, 'tmbc/', TIRES);
    expect(p.ok).toBe(false);
    expect(p.motivo).toMatch(/cliente/i);
  });

  it('rechaza un prefijo cuyo código mostrado se confunde con un número de serie existente', () => {
    const p = planCambioPrefijo(PLANTILLA, 'AC-', TIRES);
    expect(p.ok).toBe(false);
    expect(p.colisiones).toBe(2);
    expect(p.motivo).toMatch(/serie/i);
  });
});

describe('aplicarCambioPrefijo', () => {
  const fakeTenant = () => {
    const llamadas = [];
    return { llamadas, updateOne: async (filtro, update) => { llamadas.push({ filtro, update }); return { matchedCount: 1, modifiedCount: 1 }; } };
  };

  it('escribe el $set filtrando por _id Y isDemoTemplate (nunca un cliente real)', async () => {
    const Tenant = fakeTenant();
    const r = await aplicarCambioPrefijo(Tenant, PLANTILLA, planCambioPrefijo(PLANTILLA, 'ANC-', TIRES));
    expect(r.escrito).toBe(true);
    expect(Tenant.llamadas).toEqual([
      { filtro: { _id: 't1', isDemoTemplate: true, demoOf: null }, update: { $set: { tireCodePrefix: 'ANC-' } } },
    ]);
  });

  it('no escribe si el plan no cambia nada o no es válido', async () => {
    const Tenant = fakeTenant();
    await aplicarCambioPrefijo(Tenant, PLANTILLA, planCambioPrefijo({ ...PLANTILLA, tireCodePrefix: 'ANC-' }, 'ANC-', TIRES));
    await aplicarCambioPrefijo(Tenant, PLANTILLA, planCambioPrefijo({ ...PLANTILLA, isDemoTemplate: false }, 'ANC-', TIRES));
    expect(Tenant.llamadas).toEqual([]);
  });
});
