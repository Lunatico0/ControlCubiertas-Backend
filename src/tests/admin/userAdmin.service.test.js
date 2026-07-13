import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { listUsers, createUser, setUserStatus, resetPassword } from '../../services/userAdmin.service.js';
import { hashPassword, verifyPassword } from '../../services/auth.service.js';

describe('userAdmin.service (gestión de usuarios del tenant)', () => {
  let mongod;
  let tenantA;
  let tenantB;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectControlPlane(mongod.getUri());
    const { User, Tenant } = getControlModels();
    await User.init();
    tenantA = await Tenant.create({ name: 'A', dbName: 'tenant_a_adm' });
    tenantB = await Tenant.create({ name: 'B', dbName: 'tenant_b_adm' });
    await User.create({ email: 'admin@a.com', passwordHash: await hashPassword('x'), tenantId: tenantA._id, role: 'tenant-admin' });
    await User.create({ email: 'op@b.com', passwordHash: await hashPassword('x'), tenantId: tenantB._id, role: 'operator' });
  });

  afterAll(async () => {
    await closeControlPlane();
    await mongod.stop();
  });

  it('listUsers devuelve solo los del tenant y sin passwordHash', async () => {
    const users = await listUsers(tenantA._id);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('admin@a.com');
    expect(users[0].passwordHash).toBeUndefined();
  });

  it('createUser crea con password temporal, rol y mustChangePassword=true', async () => {
    const { user, tempPassword } = await createUser(tenantA._id, { email: 'Op@A.com', name: 'Op A', role: 'operator' });
    expect(tempPassword).toBeTruthy();
    expect(user.email).toBe('op@a.com');
    expect(user.role).toBe('operator');
    expect(user.mustChangePassword).toBe(true);
    expect(user.passwordHash).toBeUndefined();
  });

  it('createUser rechaza email duplicado', async () => {
    await expect(createUser(tenantA._id, { email: 'op@a.com', role: 'operator' })).rejects.toThrow();
  });

  it('setUserStatus desactiva un operativo', async () => {
    const op = (await listUsers(tenantA._id)).find((u) => u.role === 'operator');
    const updated = await setUserStatus(tenantA._id, op._id, 'inactive');
    expect(updated.status).toBe('inactive');
  });

  it('setUserStatus NO permite desactivar al único admin', async () => {
    const admin = (await listUsers(tenantA._id)).find((u) => u.role === 'tenant-admin');
    await expect(setUserStatus(tenantA._id, admin._id, 'inactive')).rejects.toThrow();
  });

  it('no permite tocar un usuario de otro tenant (scope)', async () => {
    const opB = (await listUsers(tenantB._id))[0];
    await expect(setUserStatus(tenantA._id, opB._id, 'inactive')).rejects.toThrow();
  });

  it('resetPassword genera una temporal nueva, setea mustChangePassword=true y la deja usable', async () => {
    const { User } = getControlModels();
    const op = (await listUsers(tenantA._id)).find((u) => u.role === 'operator');
    const { user, tempPassword } = await resetPassword(tenantA._id, op._id);
    expect(tempPassword).toBeTruthy();
    expect(user._id.toString()).toBe(op._id.toString());
    expect(user.mustChangePassword).toBe(true);
    expect(user.passwordHash).toBeUndefined(); // no se filtra el hash
    // la temporal efectivamente aplica sobre el usuario
    const raw = await User.findById(op._id);
    expect(await verifyPassword(tempPassword, raw.passwordHash)).toBe(true);
  });

  it('resetPassword no toca un usuario de otro tenant (scope)', async () => {
    const opB = (await listUsers(tenantB._id))[0];
    await expect(resetPassword(tenantA._id, opB._id)).rejects.toThrow();
  });
});
