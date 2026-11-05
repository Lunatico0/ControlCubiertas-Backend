import { planOperarioDemo, crearOperarioDemo, OPERARIO_DEMO } from '../../../scripts/crear-operario-demo.js';

// El recuadro del login demo ofrece un operario que no existía en el control plane. El script
// lo crea en la PLANTILLA, con la clave pública del recuadro. Se prueba el plan (cuándo crea,
// cuándo no hace nada, a qué tenants se niega) y que la escritura es un create acotado.

const PLANTILLA = { _id: 't1', name: 'Andes Cargo', dbName: 'tenant_andes_cargo', isDemoTemplate: true, demoOf: null };

describe('planOperarioDemo', () => {
  it('crea el operario del recuadro en la plantilla, rol operator, sin forzar cambio de clave', () => {
    const p = planOperarioDemo(PLANTILLA, null);
    expect(p.ok).toBe(true);
    expect(p.crea).toBe(true);
    expect(p.usuario).toEqual({
      email: 'operario@andescargo.com', name: OPERARIO_DEMO.name, role: 'operator',
      tenantId: 't1', status: 'active', mustChangePassword: false,
    });
  });

  it('es idempotente: si el email ya existe no hace nada y lo dice', () => {
    const p = planOperarioDemo(PLANTILLA, { email: 'operario@andescargo.com', tenantId: 't1', role: 'operator' });
    expect(p.ok).toBe(true);
    expect(p.crea).toBe(false);
    expect(p.motivo).toMatch(/ya existe/i);
  });

  it('si el email existe en OTRO tenant tampoco lo toca, y avisa', () => {
    const p = planOperarioDemo(PLANTILLA, { email: 'operario@andescargo.com', tenantId: 'otro', role: 'operator' });
    expect(p.crea).toBe(false);
    expect(p.motivo).toMatch(/otro tenant/i);
  });

  it('se niega si el tenant no es plantilla de demo (un cliente real)', () => {
    const p = planOperarioDemo({ ...PLANTILLA, isDemoTemplate: false }, null);
    expect(p.ok).toBe(false);
    expect(p.motivo).toMatch(/plantilla/i);
  });

  it('se niega con un clon efímero (demoOf) o un tenant inexistente', () => {
    expect(planOperarioDemo({ ...PLANTILLA, demoOf: 't0' }, null).ok).toBe(false);
    expect(planOperarioDemo(null, null).ok).toBe(false);
  });
});

describe('crearOperarioDemo', () => {
  const fakeUser = () => {
    const creados = [];
    return { creados, create: async (doc) => { creados.push(doc); return doc; } };
  };

  it('crea un único usuario con el hash recibido', async () => {
    const User = fakeUser();
    const r = await crearOperarioDemo(User, planOperarioDemo(PLANTILLA, null), 'HASH');
    expect(r.creado).toBe(true);
    expect(User.creados).toHaveLength(1);
    expect(User.creados[0]).toMatchObject({ email: 'operario@andescargo.com', role: 'operator', tenantId: 't1', passwordHash: 'HASH', mustChangePassword: false });
  });

  it('no escribe si el plan no crea o no es válido', async () => {
    const User = fakeUser();
    await crearOperarioDemo(User, planOperarioDemo(PLANTILLA, { email: 'operario@andescargo.com', tenantId: 't1' }), 'HASH');
    await crearOperarioDemo(User, planOperarioDemo({ ...PLANTILLA, isDemoTemplate: false }, null), 'HASH');
    expect(User.creados).toEqual([]);
  });
});
