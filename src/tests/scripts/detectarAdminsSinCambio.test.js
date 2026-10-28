import { detectarAdminsSinCambio } from '../../../scripts/detectar-admins-sin-cambio.js';

// M8 (plan de la auditoría 26/10): antes del fix A3, provisionTenant creaba el admin SIN
// mustChangePassword. Los admins que nunca cambiaron su clave (ni se la resetearon: los dos
// caminos suben tokenVersion) siguen operando con la temporal que alguien les entregó. El
// script solo LISTA: forzar el cambio lo decide Patricio. Se prueba la detección pura.

const T_REAL = { _id: 't1', name: 'Transportes Sur', dbName: 'tenant_sur', status: 'active' };
const T_OTRO = { _id: 't2', name: 'Fletes Norte', dbName: 'tenant_norte', status: 'suspended' };
const T_PLANTILLA = { _id: 't3', name: 'Andes Cargo', dbName: 'tenant_andes', isDemoTemplate: true };
const T_CLON = { _id: 't4', name: 'Andes Cargo', dbName: 'tenant_demo_ab12', demoOf: 't3' };
const TENANTS = [T_REAL, T_OTRO, T_PLANTILLA, T_CLON];

const admin = (over) => ({ _id: 'u', email: 'a@x.com', role: 'tenant-admin', status: 'active', tenantId: 't1', ...over });

describe('detectarAdminsSinCambio', () => {
  it('lista un tenant-admin con tokenVersion 0 (o sin el campo)', () => {
    const users = [
      admin({ _id: 'u1', email: 'uno@sur.com', tokenVersion: 0 }),
      admin({ _id: 'u2', email: 'dos@norte.com', tenantId: 't2' }), // documento previo al campo
    ];
    const r = detectarAdminsSinCambio(users, TENANTS);
    expect(r.map((x) => x.email)).toEqual(['uno@sur.com', 'dos@norte.com']);
    expect(r[0]).toMatchObject({ tenant: 'Transportes Sur', dbName: 'tenant_sur', tenantStatus: 'active' });
    expect(r[1]).toMatchObject({ tenant: 'Fletes Norte', tenantStatus: 'suspended' });
  });

  it('no lista a quien ya cambió o le resetearon la clave (tokenVersion > 0)', () => {
    const r = detectarAdminsSinCambio([admin({ tokenVersion: 2 })], TENANTS);
    expect(r).toEqual([]);
  });

  it('no lista operarios', () => {
    const r = detectarAdminsSinCambio([admin({ role: 'operator', tokenVersion: 0 })], TENANTS);
    expect(r).toEqual([]);
  });

  it('excluye la plantilla de la demo y sus clones', () => {
    const users = [
      admin({ _id: 'p', tenantId: 't3', tokenVersion: 0 }),
      admin({ _id: 'c', tenantId: 't4', tokenVersion: 0 }),
    ];
    expect(detectarAdminsSinCambio(users, TENANTS)).toEqual([]);
  });

  it('no lista a quien ya está obligado (mustChangePassword) ni a los inactivos: no pueden operar', () => {
    const users = [
      admin({ _id: 'm', tokenVersion: 0, mustChangePassword: true }),
      admin({ _id: 'i', tokenVersion: 0, status: 'inactive' }),
    ];
    expect(detectarAdminsSinCambio(users, TENANTS)).toEqual([]);
  });

  it('compara ids como string (ObjectId del driver contra ObjectId)', () => {
    const oid = (s) => ({ toString: () => s });
    const users = [admin({ tenantId: oid('t1'), tokenVersion: 0 })];
    const tenants = [{ ...T_REAL, _id: oid('t1') }];
    expect(detectarAdminsSinCambio(users, tenants)).toHaveLength(1);
  });

  it('un admin cuyo tenant ya no existe se lista igual, marcado', () => {
    const r = detectarAdminsSinCambio([admin({ tenantId: 'borrado', tokenVersion: 0 })], TENANTS);
    expect(r).toHaveLength(1);
    expect(r[0].tenant).toBeNull();
  });
});
