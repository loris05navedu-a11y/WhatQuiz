import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AckResult, PublicUser } from '../../shared/types';
import { connectSocket, startTestServer, TEST_PAGES_ORIGIN, type TestServer } from './helpers';

describe('frontend hébergé sur un autre domaine (GitHub Pages)', () => {
  let server: TestServer;
  let token: string;

  const call = (method: string, path: string, options: { body?: unknown; origin?: string; token?: string; mode?: boolean } = {}) =>
    fetch(server.url + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.mode ? { 'x-auth-mode': 'token' } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it('renvoie un jeton (et aucun cookie) en mode jeton', async () => {
    const response = await call('POST', '/api/auth/register', {
      origin: TEST_PAGES_ORIGIN,
      mode: true,
      body: { email: 'pages@test.fr', password: 'motdepasse', displayName: 'Prof', role: 'teacher' },
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('access-control-allow-origin'), TEST_PAGES_ORIGIN);
    const data = (await response.json()) as { user: PublicUser; token?: string };
    assert.match(data.token ?? '', /^[\w-]{20,}$/);
    token = data.token!;
  });

  it('garde le cookie pour un usage classique sur la même origine', async () => {
    const response = await call('POST', '/api/auth/login', { body: { email: 'pages@test.fr', password: 'motdepasse' } });
    assert.match(response.headers.get('set-cookie') ?? '', /wq_session=/);
    assert.equal(((await response.json()) as { token?: string }).token, undefined);
  });

  it('authentifie les requêtes par jeton Bearer et rejette un jeton inconnu', async () => {
    const me = await call('GET', '/api/auth/me', { token, origin: TEST_PAGES_ORIGIN });
    assert.equal(((await me.json()) as { user: PublicUser | null }).user?.email, 'pages@test.fr');
    const bad = await call('GET', '/api/auth/me', { token: 'x'.repeat(43) });
    assert.equal(((await bad.json()) as { user: unknown }).user, null);
  });

  it('répond au pré-contrôle CORS uniquement pour les origines autorisées', async () => {
    const ok = await call('OPTIONS', '/api/quizzes', { origin: TEST_PAGES_ORIGIN });
    assert.equal(ok.status, 204);
    assert.match(ok.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    const other = await call('OPTIONS', '/api/quizzes', { origin: 'https://pirate.example' });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    const get = await call('GET', '/api/auth/me', { origin: 'https://pirate.example' });
    assert.equal(get.headers.get('access-control-allow-origin'), null);
  });

  it('identifie le professeur sur Socket.IO grâce au jeton', async () => {
    const created = await call('POST', '/api/quizzes', {
      token,
      body: { title: 'Q', description: '', imageUrl: null, category: 'Autre', questions: [] },
    });
    assert.equal(created.status, 201);
    const withToken = await connectSocketWithToken(server, token);
    const anonymous = await connectSocket(server);
    const attempt = (socket: typeof anonymous) =>
      new Promise<AckResult>((resolve) => socket.emit('host:join', { code: '000000' }, resolve));
    // Sans session : refus d'authentification ; avec jeton : on atteint la vérification du code de partie.
    assert.deepEqual(await attempt(anonymous), { ok: false, error: 'Veuillez vous connecter' });
    assert.deepEqual(await attempt(withToken), { ok: false, error: 'Code de partie incorrect' });
    withToken.disconnect();
    anonymous.disconnect();
  });

  it('révoque la session à la déconnexion par jeton', async () => {
    assert.equal((await call('POST', '/api/auth/logout', { token, body: {} })).status, 200);
    const me = await call('GET', '/api/auth/me', { token });
    assert.equal(((await me.json()) as { user: unknown }).user, null);
  });
});

async function connectSocketWithToken(server: TestServer, token: string) {
  const { io } = await import('socket.io-client');
  const socket = io(server.url, { transports: ['websocket'], auth: { token }, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket as unknown as Awaited<ReturnType<typeof connectSocket>>;
}
