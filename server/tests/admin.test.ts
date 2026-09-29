import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AdminUserRow } from '../../shared/types';
import { ApiClient, registerTeacher, startTestServer, type TestServer } from './helpers';

describe('administration', () => {
  let server: TestServer;
  let admin: ApiClient;
  let other: ApiClient;

  before(async () => {
    server = await startTestServer();
    admin = await registerTeacher(server, 'admin@test.fr');
    other = await registerTeacher(server, 'cobaye@test.fr');
  });
  after(() => server.close());

  it("refuse l'accès aux non-administrateurs", async () => {
    assert.equal((await other.get('/api/admin/users')).status, 403);
    assert.equal((await new ApiClient(server.url).get('/api/admin/users')).status, 401);
  });

  it('liste les comptes et supprime un compte (son e-mail redevient libre)', async () => {
    const { data } = await admin.get<{ users: AdminUserRow[] }>('/api/admin/users');
    assert.equal(data.users.length, 2);
    const target = data.users.find((u) => u.email === 'cobaye@test.fr')!;
    assert.equal((await admin.delete(`/api/admin/users/${target.id}`)).status, 200);
    assert.equal((await other.get<{ user: unknown }>('/api/auth/me')).data.user, null);
    const again = new ApiClient(server.url);
    const { status } = await again.post('/api/auth/register', { email: 'cobaye@test.fr', password: 'motdepasse', displayName: 'Neuf', role: 'teacher' });
    assert.equal(status, 201);
  });

  it('protège les administrateurs et le compte courant', async () => {
    const { data } = await admin.get<{ users: AdminUserRow[] }>('/api/admin/users');
    const me = data.users.find((u) => u.isAdmin)!;
    assert.equal((await admin.delete(`/api/admin/users/${me.id}`)).status, 400);
    assert.equal((await admin.delete('/api/admin/users/9999')).status, 404);
  });
});
