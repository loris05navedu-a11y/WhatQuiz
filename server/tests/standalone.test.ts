import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AckResult, HostView, PlayerView, PublicUser, Quiz, QuizInput } from '../../shared/types';
import { quizSchema } from '../src/validation';

// Stockage du navigateur simulé : le mode sans serveur y garde le compte ouvert.
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  },
});

const { localApi, recordPlayedGame } = await import('../../client/src/standalone/api');
const { hub, DoorTakenError } = await import('../../client/src/standalone/hub');

const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const QUIZ: QuizInput = {
  title: 'Quiz hors ligne',
  description: '',
  imageUrl: IMAGE,
  category: 'Culture générale',
  questions: [
    {
      type: 'single',
      text: 'Combien font 2 + 2 ?',
      imageUrl: IMAGE,
      timeLimit: 20,
      points: 1000,
      pointsEnabled: true,
      answers: [
        { text: '3', isCorrect: false },
        { text: '4', isCorrect: true },
      ],
    },
  ],
};

interface Inbox {
  events: [string, unknown][];
  last<T>(event: string): T | undefined;
}

function inbox(): Inbox & { deliver: (event: string, payload?: unknown) => void } {
  const events: [string, unknown][] = [];
  return {
    events,
    deliver: (event, payload) => void events.push([event, payload]),
    last: <T>(event: string) => events.filter(([e]) => e === event).at(-1)?.[1] as T | undefined,
  };
}

function send<T extends object = object>(client: Parameters<typeof hub.handle>[0], event: string, payload?: unknown): AckResult<T> {
  let result: AckResult<T> | undefined;
  hub.handle(client, event, payload, (r) => (result = r as AckResult<T>));
  assert.ok(result, `pas d'acquittement pour ${event}`);
  return result;
}

describe('mode sans serveur (GitHub Pages)', () => {
  let doorAttempts = 0;
  let closedDoors = 0;

  before(() => {
    hub.openDoor = async () => {
      doorAttempts += 1;
      if (doorAttempts === 1) throw new DoorTakenError();
      return { close: () => void closedDoors++ };
    };
  });

  after(() => {
    for (const room of [...hub.listByHost(1), ...hub.listByHost(2)]) hub.remove(room);
  });

  let teacher: PublicUser;
  let quiz: Quiz;

  it('crée un compte professeur conservé sur l’appareil', async () => {
    ({ user: teacher } = await localApi<{ user: PublicUser }>('POST', '/auth/register', {
      email: 'Prof@Ecole.fr',
      password: 'motdepasse1',
      displayName: 'Mme Prof',
      role: 'teacher',
    }));
    assert.equal(teacher.email, 'prof@ecole.fr');
    assert.deepEqual((await localApi<{ user: PublicUser }>('GET', '/auth/me')).user, teacher);

    await localApi('POST', '/auth/logout');
    await assert.rejects(localApi('POST', '/auth/login', { email: 'prof@ecole.fr', password: 'mauvais' }), /incorrect/);
    await localApi('POST', '/auth/login', { email: 'prof@ecole.fr', password: 'motdepasse1' });
    await assert.rejects(
      localApi('POST', '/auth/register', { email: 'prof@ecole.fr', password: 'motdepasse1', displayName: 'X', role: 'teacher' }),
      /existe déjà/,
    );
  });

  it('garde les images dans le quiz (pas de serveur de fichiers)', async () => {
    assert.equal(quizSchema.safeParse(QUIZ).success, false, 'le serveur refuse toujours les images intégrées');
    ({ quiz } = await localApi<{ quiz: Quiz }>('POST', '/quizzes', QUIZ));
    assert.equal(quiz.questions[0].imageUrl, IMAGE);
    const { url } = await localApi<{ url: string }>('POST', '/uploads', { dataUrl: IMAGE });
    assert.equal(url, IMAGE);
    await localApi('POST', `/quizzes/${quiz.id}/duplicate`);
    const { quizzes } = await localApi<{ quizzes: { title: string }[] }>('GET', '/quizzes');
    assert.deepEqual(quizzes.map((q) => q.title).sort(), ['Quiz hors ligne', 'Quiz hors ligne (copie)']);
  });

  it('joue une partie en direct avec un élève distant, puis enregistre les résultats', async () => {
    const { gameId, code } = await localApi<{ gameId: string; code: string }>('POST', '/games', { quizId: quiz.id, mode: 'live' });
    assert.equal(doorAttempts, 2, 'un code déjà pris ailleurs est remplacé');
    assert.deepEqual(await localApi('GET', `/games/code/${code}`), { code, quizTitle: 'Quiz hors ligne' });

    const hostBox = inbox();
    const host = hub.connect(teacher, hostBox.deliver);
    assert.deepEqual(send(host, 'host:join', { code }), { ok: true });

    const playerBox = inbox();
    const student = hub.connect(null, playerBox.deliver);
    assert.equal(send(student, 'host:join', { code }).ok, false, 'un élève distant ne peut pas piloter la partie');
    assert.deepEqual(send(student, 'game:check', { code }), { ok: true, code, quizTitle: 'Quiz hors ligne' });
    const joined = send<{ playerId: string; token: string }>(student, 'game:join', { code, nickname: 'Léo' });
    assert.ok(joined.ok);
    assert.equal(send(student, 'host:action', { type: 'start' }).ok, false);

    send(host, 'host:action', { type: 'start' });
    send(host, 'host:action', { type: 'startQuestion' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const question = playerBox.last<PlayerView>('game:state')?.question;
    assert.ok(question);
    assert.equal(JSON.stringify(question).includes('isCorrect'), false, 'la bonne réponse reste sur l’appareil du professeur');

    assert.deepEqual(send(student, 'game:answer', { questionIndex: 0, answer: { kind: 'choice', choices: [1] } }), { ok: true });
    send(host, 'host:action', { type: 'end' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(hostBox.last<HostView>('host:state')?.phase, 'ended');

    const { results } = await localApi<{ results: { players: { nickname: string; correctCount: number }[] } }>(
      'GET',
      `/games/${gameId}/results`,
    );
    assert.deepEqual(
      results.players.map((p) => [p.nickname, p.correctCount]),
      [['Léo', 1]],
    );
    const { stats } = await localApi<{ stats: { gameCount: number; playerCount: number } }>('GET', '/games/stats');
    assert.deepEqual([stats.gameCount, stats.playerCount], [1, 1]);

    await localApi('DELETE', `/games/${gameId}`);
    assert.equal(hub.hasRoom(code), false);
    assert.equal(closedDoors, 1, 'la porte pair-à-pair est refermée avec la partie');
  });

  it('ajoute les parties terminées à l’historique d’un élève', async () => {
    await localApi('POST', '/auth/register', { email: 'eleve@ecole.fr', password: 'motdepasse1', displayName: 'Léo', role: 'student' });
    await recordPlayedGame({
      code: '123456',
      quizTitle: 'Quiz hors ligne',
      phase: 'ended',
      isTest: false,
      me: { id: 'p1', nickname: 'Léo', score: 900, rank: 1 },
      playerCount: 12,
      final: { rank: 1, score: 900, playerCount: 12, podium: [] },
    } as unknown as PlayerView);
    const { history } = await localApi<{ history: { quizTitle: string; rank: number | null }[] }>('GET', '/account/history');
    assert.deepEqual(
      history.map((h) => [h.quizTitle, h.rank]),
      [['Quiz hors ligne', 1]],
    );
    await assert.rejects(localApi('GET', '/quizzes'), /professeur/);
  });
});
