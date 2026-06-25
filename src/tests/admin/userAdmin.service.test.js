import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { listUsers, createUser, setUserStatus } from '../../services/userAdmin.service.js';
import { hashPassword } from '../../services/auth.service.js';

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
});
