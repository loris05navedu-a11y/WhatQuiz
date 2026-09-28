import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ApiClient, startTestServer, type TestServer } from './helpers';

describe('authentification', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it('crée un compte, ouvre une session et ne stocke jamais le mot de passe en clair', async () => {
    const client = new ApiClient(server.url);
    const { status, data } = await client.post<{ user: { email: string; role: string } }>('/api/auth/register', {
      email: 'Alice@Test.fr',
      password: 'secret123',
      displayName: 'Alice',
      role: 'teacher',
    });
    assert.equal(status, 201);
    assert.equal(data.user.email, 'alice@test.fr');
    assert.match(client.cookie, /^wq_session=/);

    const me = await client.get<{ user: { email: string } | null }>('/api/auth/me');
    assert.equal(me.data.user?.email, 'alice@test.fr');

    const stored = server.app.services.users.findByEmail('alice@test.fr');
    assert.ok(stored && !stored.passwordHash.includes('secret123'));
    assert.match(stored.passwordHash, /^scrypt\$/);
  });

  it('refuse un e-mail déjà utilisé et un mot de passe trop court', async () => {
    const client = new ApiClient(server.url);
    const duplicate = await client.post('/api/auth/register', { email: 'alice@test.fr', password: 'secret123', displayName: 'A' });
    assert.equal(duplicate.status, 409);
    const short = await client.post('/api/auth/register', { email: 'b@test.fr', password: '123', displayName: 'B' });
    assert.equal(short.status, 400);
  });

  it('se connecte, se déconnecte et rejette un mauvais mot de passe', async () => {
    const client = new ApiClient(server.url);
    const bad = await client.post('/api/auth/login', { email: 'alice@test.fr', password: 'mauvais' });
    assert.equal(bad.status, 401);
    assert.equal(bad.data.error, 'E-mail ou mot de passe incorrect');

    const ok = await client.post('/api/auth/login', { email: 'ALICE@test.fr', password: 'secret123' });
    assert.equal(ok.status, 200);
    assert.equal((await client.get('/api/quizzes')).status, 200);

    await client.post('/api/auth/logout');
    const me = await client.get<{ user: unknown }>('/api/auth/me');
    assert.equal(me.data.user, null);
    assert.equal((await client.get('/api/quizzes')).status, 401);
  });

  it("empêche un compte élève d'accéder aux données professeur", async () => {
    const student = new ApiClient(server.url);
    await student.post('/api/auth/register', { email: 'eleve@test.fr', password: 'secret123', displayName: 'Élève', role: 'student' });
    assert.equal((await student.get('/api/quizzes')).status, 403);
    assert.equal((await student.post('/api/games', { quizId: 1 })).status, 403);
  });

  it('refuse les mutations qui ne sont pas en JSON (protection CSRF)', async () => {
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a&password=b',
    });
    assert.equal(response.status, 415);
  });

  it('crée un compte démo avec un quiz prêt à jouer', async () => {
    const client = new ApiClient(server.url);
    const { status } = await client.post('/api/auth/demo');
    assert.equal(status, 201);
    const list = await client.get<{ quizzes: { questionCount: number }[] }>('/api/quizzes');
    assert.equal(list.data.quizzes.length, 1);
    assert.ok(list.data.quizzes[0].questionCount >= 4);
  });
});
