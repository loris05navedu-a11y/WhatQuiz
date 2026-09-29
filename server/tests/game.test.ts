import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AckResult, GameResults, HostAction, Quiz } from '../../shared/types';
import {
  connectSocket,
  nextEvent,
  registerTeacher,
  SAMPLE_QUIZ,
  startTestServer,
  type ApiClient,
  type TestServer,
  type TestSocket,
} from './helpers';

function emitAck<T extends object = object>(socket: TestSocket, event: 'game:join' | 'game:answer' | 'host:join' | 'host:action', payload: unknown) {
  return new Promise<AckResult<T>>((resolve) => {
    (socket.emit as (event: string, payload: unknown, ack: (r: AckResult<T>) => void) => void)(event, payload, resolve);
  });
}

const act = (socket: TestSocket, action: HostAction) => emitAck(socket, 'host:action', action);

describe('partie en direct', () => {
  let server: TestServer;
  let teacher: ApiClient;
  let quizId: number;
  let gameId: string;
  let code: string;
  let host: TestSocket;
  let alice: TestSocket;
  let bob: TestSocket;
  let aliceId: string;

  before(async () => {
    server = await startTestServer();
    teacher = await registerTeacher(server);
    const { data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', SAMPLE_QUIZ);
    quizId = data.quiz.id;
  });

  after(async () => {
    for (const socket of [host, alice, bob]) socket?.disconnect();
    await server.close();
  });

  it('crée une partie avec un code à 6 chiffres', async () => {
    const { status, data } = await teacher.post<{ gameId: string; code: string }>('/api/games', { quizId, settings: { scoringMode: 'fixed' } });
    assert.equal(status, 201);
    assert.match(data.code, /^\d{6}$/);
    gameId = data.gameId;
    code = data.code;
    const check = await teacher.get<{ quizTitle: string }>(`/api/games/code/${code}`);
    assert.equal(check.data.quizTitle, 'Quiz de test');
    assert.equal((await teacher.get('/api/games/code/000000')).status, 404);
  });

  it("réserve le contrôle de la partie au professeur qui l'a créée", async () => {
    const intruder = await connectSocket(server);
    const result = await emitAck(intruder, 'host:join', { code });
    assert.equal(result.ok, false);
    intruder.disconnect();

    host = await connectSocket(server, teacher.cookie);
    const joined = await emitAck(host, 'host:join', { code });
    assert.equal(joined.ok, true);
  });

  it('permet aux élèves de rejoindre avec code et pseudo', async () => {
    alice = await connectSocket(server);
    bob = await connectSocket(server);

    const wrongCode = await emitAck(alice, 'game:join', { code: '999999', nickname: 'Alice' });
    assert.deepEqual(wrongCode, { ok: false, error: 'Code de partie incorrect' });

    const hostUpdate = nextEvent(host, 'host:state', (view) => view.players.length === 1);
    const joined = await emitAck<{ playerId: string; token: string }>(alice, 'game:join', { code, nickname: 'Alice' });
    assert.equal(joined.ok, true);
    if (joined.ok) aliceId = joined.playerId;
    assert.equal((await hostUpdate).players[0].nickname, 'Alice');

    const duplicate = await emitAck(bob, 'game:join', { code, nickname: ' alice ' });
    assert.deepEqual(duplicate, { ok: false, error: 'Ce pseudo est déjà utilisé' });
    assert.equal((await emitAck(bob, 'game:join', { code, nickname: 'Bob' })).ok, true);
  });

  it("transmet les réactions des élèves à l'écran du professeur", async () => {
    const reaction = nextEvent(host, 'host:reaction');
    alice.emit('game:react', { emoji: '🎉' });
    alice.emit('game:react', { emoji: '👏' });
    assert.deepEqual(await reaction, { emoji: '👏', nickname: 'Alice' });

    const intruder = await connectSocket(server);
    let leaked = false;
    host.once('host:reaction', () => (leaked = true));
    intruder.emit('game:react', { emoji: '👍' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(leaked, false);
    intruder.disconnect();
  });

  it('verrouille les inscriptions et exclut un joueur', async () => {
    await act(host, { type: 'setLocked', value: true });
    const late = await connectSocket(server);
    assert.deepEqual(await emitAck(late, 'game:join', { code, nickname: 'Retard' }), { ok: false, error: 'Les inscriptions sont verrouillées' });
    await act(host, { type: 'setLocked', value: false });
    assert.equal((await emitAck(late, 'game:join', { code, nickname: 'Retard' })).ok, true);

    const kicked = nextEvent(late, 'game:kicked');
    const view = await new Promise<{ players: { id: string; nickname: string }[] }>((resolve) => {
      host.once('host:state', resolve);
    });
    const target = view.players.find((p) => p.nickname === 'Retard') ?? { id: '' };
    await act(host, { type: 'kick', playerId: target.id });
    await kicked;
    late.disconnect();
  });

  it('refuse une réponse avant l’ouverture de la question', async () => {
    const early = await emitAck(alice, 'game:answer', { questionIndex: 0, answer: { kind: 'choice', choices: [1] } });
    assert.equal(early.ok, false);
  });

  it('diffuse la question sans jamais révéler la bonne réponse aux élèves', async () => {
    assert.equal((await act(host, { type: 'start' })).ok, true);
    const questionView = nextEvent(alice, 'game:state', (view) => view.phase === 'question');
    assert.equal((await act(host, { type: 'startQuestion' })).ok, true);
    const view = await questionView;
    assert.deepEqual(view.question?.choices, ['3', '4']);
    assert.equal(view.correction, null);
    assert.equal(JSON.stringify(view).includes('isCorrect'), false);
    assert.ok(view.timer && view.timer.remainingMs > 0 && view.timer.remainingMs <= 20_000);
  });

  it('enregistre une réponse une seule fois', async () => {
    assert.deepEqual(await emitAck(alice, 'game:answer', { questionIndex: 0, answer: { kind: 'choice', choices: [1] } }), { ok: true });
    const again = await emitAck(alice, 'game:answer', { questionIndex: 0, answer: { kind: 'choice', choices: [0] } });
    assert.deepEqual(again, { ok: false, error: 'Réponse déjà enregistrée' });
    const invalid = await emitAck(bob, 'game:answer', { questionIndex: 0, answer: { kind: 'choice', choices: [0, 1] } });
    assert.equal(invalid.ok, false);
  });

  it('termine la question quand tout le monde a répondu et calcule les scores côté serveur', async () => {
    const revealed = nextEvent(alice, 'game:state', (view) => view.phase === 'reveal');
    assert.deepEqual(await emitAck(bob, 'game:answer', { questionIndex: 0, answer: { kind: 'choice', choices: [0] } }), { ok: true });
    const view = await revealed;
    assert.deepEqual(view.outcome, { answered: true, correct: true, points: 1000 });
    assert.deepEqual(view.correction?.correctChoices, [1]);
    assert.equal(view.me.score, 1000);

    const late = await emitAck(bob, 'game:answer', { questionIndex: 0, answer: { kind: 'choice', choices: [1] } });
    assert.deepEqual(late, { ok: false, error: 'Le temps est écoulé' });
  });

  it("n'affiche le classement aux élèves que sur autorisation", async () => {
    const hidden = await new Promise<{ leaderboard: unknown }>((resolve) => {
      alice.once('game:state', resolve);
      void act(host, { type: 'setAnswersVisible', value: true });
    });
    assert.equal(hidden.leaderboard, null);
    const shown = nextEvent(alice, 'game:state', (view) => view.leaderboard !== null);
    await act(host, { type: 'setLeaderboardVisible', value: true });
    const view = await shown;
    assert.equal(view.leaderboard?.[0].nickname, 'Alice');
    assert.equal(view.me.rank, 1);
  });

  it('gère une réponse texte avec tolérance', async () => {
    await act(host, { type: 'next' });
    await act(host, { type: 'startQuestion' });
    assert.deepEqual(await emitAck(bob, 'game:answer', { questionIndex: 1, answer: { kind: 'text', text: ' paris ' } }), { ok: true });
  });

  it('met en pause et bloque les réponses pendant la pause', async () => {
    await act(host, { type: 'pause' });
    const paused = await emitAck(alice, 'game:answer', { questionIndex: 1, answer: { kind: 'text', text: 'Lyon' } });
    assert.equal(paused.ok, false);
    await act(host, { type: 'resume' });
    assert.equal((await emitAck(alice, 'game:answer', { questionIndex: 1, answer: { kind: 'text', text: 'Lyon' } })).ok, true);
  });

  it('termine la partie et enregistre les résultats', async () => {
    const ended = nextEvent(alice, 'game:state', (view) => view.phase === 'ended');
    const { status } = await teacher.post(`/api/games/${gameId}/end`);
    assert.equal(status, 200);
    const view = await ended;
    assert.equal(view.final, null, 'les résultats restent masqués tant que le professeur ne les affiche pas');

    const shown = nextEvent(alice, 'game:state', (v) => v.final !== null);
    await act(host, { type: 'setResultsVisible', value: true });
    assert.equal((await shown).final?.rank, 1);

    const { data } = await teacher.get<{ results: GameResults }>(`/api/games/${gameId}/results`);
    const results = data.results;
    assert.equal(results.game.status, 'ended');
    assert.equal(results.players.length, 2);
    assert.deepEqual(
      results.players.map((p) => [p.nickname, p.score, p.correctCount]),
      [
        ['Alice', 1000, 1],
        ['Bob', 1000, 1],
      ],
    );
    assert.equal(results.questions.length, 2);
    assert.equal(results.totals.successRate, 0.5);
    assert.equal(results.totals.answerCount, 4);
    assert.ok(aliceId);

    const stats = await teacher.get<{ stats: { gameCount: number; playerCount: number } }>('/api/games/stats');
    assert.equal(stats.data.stats.gameCount, 1);
    assert.equal(stats.data.stats.playerCount, 2);
  });

  it('refuse de rejoindre une partie terminée', async () => {
    const late = await connectSocket(server);
    assert.deepEqual(await emitAck(late, 'game:join', { code, nickname: 'Zoé' }), { ok: false, error: 'La partie est terminée' });
    late.disconnect();
  });

  it("n'enregistre rien pour une partie de test", async () => {
    const { data } = await teacher.post<{ gameId: string; code: string }>('/api/games', { quizId, mode: 'test-host' });
    const socket = await connectSocket(server, teacher.cookie);
    await emitAck(socket, 'host:join', { code: data.code });
    assert.equal((await act(socket, { type: 'addBots', count: 3 })).ok, true);
    assert.equal((await act(socket, { type: 'start' })).ok, true);
    await act(socket, { type: 'end' });
    socket.disconnect();
    const history = await teacher.get<{ games: unknown[] }>('/api/games');
    assert.equal(history.data.games.length, 1);
  });

  it('interdit les élèves fictifs dans une vraie partie', async () => {
    const { data } = await teacher.post<{ code: string }>('/api/games', { quizId });
    const socket = await connectSocket(server, teacher.cookie);
    await emitAck(socket, 'host:join', { code: data.code });
    assert.equal((await act(socket, { type: 'addBots', count: 3 })).ok, false);
    socket.disconnect();
  });
});
