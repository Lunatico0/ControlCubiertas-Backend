import { actorDe } from '../../utils/actor.js';

// Prep de A2 (autoría del historial): el autor de un movimiento sale de la sesión firmada,
// nunca del body. Se guarda como snapshot { id, name } en la entrada de History.
describe('actorDe(req)', () => {
  it('arma el actor desde req.auth (userId + claim name)', () => {
    const req = { auth: { userId: 'u1', name: 'Ana Admin', tenantId: 't1', role: 'tenant-admin' } };
    expect(actorDe(req)).toEqual({ id: 'u1', name: 'Ana Admin' });
  });

  it('un token emitido antes del claim name deja solo el id (nunca un nombre inventado)', () => {
    const req = { auth: { userId: 'u1', tenantId: 't1', role: 'operator' } };
    expect(actorDe(req)).toEqual({ id: 'u1' });
  });

  it('ignora lo que venga en el body: el autor no lo elige el cliente', () => {
    const req = { auth: { userId: 'u1', name: 'Ana' }, body: { user: { id: 'otro', name: 'Impostor' } } };
    expect(actorDe(req)).toEqual({ id: 'u1', name: 'Ana' });
  });

  it('sin sesión devuelve null (scripts y seeds no tienen autor)', () => {
    expect(actorDe({})).toBeNull();
    expect(actorDe(undefined)).toBeNull();
  });
});
