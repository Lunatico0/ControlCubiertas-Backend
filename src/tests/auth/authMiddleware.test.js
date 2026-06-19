import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { signAccessToken } from '../../services/auth.service.js';

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
});

const mockRes = () => {
  const res = {};
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

describe('authenticate', () => {
  it('rechaza request sin token (401)', () => {
    const res = mockRes();
    let nexted = false;
    authenticate({ headers: {} }, res, () => { nexted = true; });
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  it('rechaza token inválido (401)', () => {
    const res = mockRes();
    let nexted = false;
    authenticate({ headers: { authorization: 'Bearer basura' } }, res, () => { nexted = true; });
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  it('acepta token válido y setea req.auth', () => {
    const token = signAccessToken({ userId: 'u', tenantId: 't', dbName: 'db', role: 'tenant-admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    let nexted = false;
    authenticate(req, mockRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.auth.dbName).toBe('db');
    expect(req.auth.role).toBe('tenant-admin');
  });
});

describe('requireRole', () => {
  it('bloquea un rol no permitido (403)', () => {
    const res = mockRes();
    let nexted = false;
    requireRole('tenant-admin')({ auth: { role: 'operator' } }, res, () => { nexted = true; });
    expect(res.statusCode).toBe(403);
    expect(nexted).toBe(false);
  });

  it('deja pasar un rol permitido', () => {
    let nexted = false;
    requireRole('tenant-admin', 'operator')({ auth: { role: 'operator' } }, mockRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});
