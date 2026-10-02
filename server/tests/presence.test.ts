import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { DEFAULT_GAME_SETTINGS } from '../../shared/constants';
import type { PresenceEvent } from '../../shared/presence';
import type { GameSettings } from '../../shared/types';
import type { FinalPlayerResult } from '../src/db/games';
import { GameRoom, type RoomStore, type RoomTransport } from '../src/game/GameRoom';
import { presenceReportSchema } from '../src/validation';
import { SAMPLE_QUIZ } from './helpers';

const silent: RoomTransport = { sendHost() {}, sendPlayer() {}, kicked() {} };

function createRoom(settings: Partial<GameSettings> = {}) {
  const saved: { results: FinalPlayerResult[]; log: PresenceEvent[] } = { results: [], log: [] };
  const store: RoomStore = {
    markStarted() {},
    addPlayer() {},
    markKicked() {},
    saveAnswer() {},
    abort() {},
    setResultsVisible() {},
    finish(_id, _played, results, _scores, log = []) {
      saved.results = results;
      saved.log = log;
    },
  };
  const room = new GameRoom({
    id: 'g1',
    code: '123456',
    hostUserId: 1,
    snapshot: { quizId: 1, title: 'T', questions: SAMPLE_QUIZ.questions },
    settings: { ...DEFAULT_GAME_SETTINGS, ...settings },
    isTest: false,
    allowBots: true,
    store,
    transport: silent,
  });
  return { room, saved };
}

const presenceOf = (room: GameRoom, nickname: string) => room.hostView().players.find((p) => p.nickname === nickname)!.presence;

describe('surveillance de présence', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  it('ne compte rien avant le lancement, puis signale chaque sortie avec une durée mesurée par l’hôte', () => {
    const { room, saved } = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.join({ nickname: 'Bob', userId: null, socketId: 's2' });

    // Dans la salle d'attente : l'état est suivi, mais ce n'est pas une sortie.
    room.reportPresence(alice.id, { s: 'away', r: 'hidden' });
    room.reportPresence(alice.id, { s: 'back' });
    assert.equal(presenceOf(room, 'Alice').exits, 0);

    room.start();
    assert.equal(room.watching, true);
    room.reportPresence(alice.id, { s: 'away', r: 'app-leave', app: true });
    let alicePresence = presenceOf(room, 'Alice');
    assert.equal(alicePresence.state, 'away');
    assert.equal(alicePresence.reason, 'app-leave');
    assert.equal(alicePresence.exits, 1);
    assert.equal(alicePresence.app, true);
    assert.equal(room.hostView().presenceLog.at(-1)?.nickname, 'Alice');

    mock.timers.tick(4_000);
    room.reportPresence(alice.id, { s: 'back' });
    alicePresence = presenceOf(room, 'Alice');
    assert.equal(alicePresence.state, 'present');
    assert.equal(alicePresence.awayMs, 4_000);
    const back = room.hostView().presenceLog.at(-1)!;
    assert.equal(back.kind, 'back');
    assert.equal(back.durationMs, 4_000);

    room.end();
    const aliceResult = saved.results.find((r) => r.playerId === alice.id)!;
    assert.equal(aliceResult.exits, 1);
    assert.equal(aliceResult.awayMs, 4_000);
    assert.deepEqual(
      saved.log.map((e) => [e.nickname, e.kind]),
      [
        ['Alice', 'away'],
        ['Alice', 'back'],
      ],
    );
  });

  it('déclare injoignable un élève qui n’envoie plus de signe de vie (application tuée, réseau coupé)', () => {
    const { room } = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    const bob = room.join({ nickname: 'Bob', userId: null, socketId: 's2' });
    room.start();
    for (let t = 1; t <= 8; t++) {
      mock.timers.tick(1_000);
      if (t % 2 === 0) room.reportPresence(bob.id, { s: 'beat', v: true });
    }
    // Alice n'a rien envoyé depuis 8 s : injoignable. Bob, lui, est présent.
    assert.equal(presenceOf(room, 'Alice').state, 'lost');
    assert.equal(presenceOf(room, 'Alice').reason, 'silent');
    assert.equal(presenceOf(room, 'Bob').state, 'present');
    // Son prochain signe de vie la remet dans la partie, avec le temps d'absence compté par l'hôte.
    room.reportPresence(alice.id, { s: 'beat', v: true });
    assert.equal(presenceOf(room, 'Alice').state, 'present');
    assert.ok(presenceOf(room, 'Alice').awayMs >= 1_000);
    room.dispose();
  });

  it('signale une déconnexion et la reconnexion', () => {
    const { room } = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.start();
    room.disconnect('s1');
    assert.equal(presenceOf(room, 'Alice').state, 'lost');
    assert.equal(presenceOf(room, 'Alice').reason, 'disconnected');
    mock.timers.tick(3_000);
    room.join({ nickname: 'Alice', token: alice.token, userId: null, socketId: 's3' });
    room.reportPresence(alice.id, { s: 'back' });
    assert.equal(presenceOf(room, 'Alice').state, 'present');
    assert.equal(presenceOf(room, 'Alice').awayMs, 3_000);
    room.dispose();
  });

  it('aggrave une absence sans compter une deuxième sortie, et ignore les signaux en double', () => {
    const { room } = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.start();
    room.reportPresence(alice.id, { s: 'away', r: 'blur' });
    assert.equal(presenceOf(room, 'Alice').state, 'unfocused');
    room.reportPresence(alice.id, { s: 'away', r: 'hidden' });
    room.reportPresence(alice.id, { s: 'away', r: 'hidden' });
    room.reportPresence(alice.id, { s: 'beat', v: false });
    assert.equal(presenceOf(room, 'Alice').state, 'away');
    assert.equal(presenceOf(room, 'Alice').exits, 1);
    room.reportPresence(alice.id, { s: 'back' });
    room.reportPresence(alice.id, { s: 'back' });
    assert.equal(room.hostView().presenceLog.length, 3);
    room.dispose();
  });

  it('un signe de vie « absent » rattrape un message de sortie perdu', () => {
    const { room } = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.start();
    room.reportPresence(alice.id, { s: 'beat', v: false });
    assert.equal(presenceOf(room, 'Alice').state, 'away');
    assert.equal(presenceOf(room, 'Alice').exits, 1);
    room.dispose();
  });

  it('compte un élève déjà absent au lancement et clôt les absences en fin de partie', () => {
    const { room, saved } = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.reportPresence(alice.id, { s: 'away', r: 'hidden' });
    room.start();
    assert.equal(presenceOf(room, 'Alice').exits, 1);
    mock.timers.tick(5_000);
    room.reportPresence(alice.id, { s: 'beat', v: false });
    room.end();
    assert.equal(saved.results[0].exits, 1);
    assert.equal(saved.results[0].awayMs, 5_000);
  });

  it('ne surveille pas quand le professeur l’a désactivé (ni les élèves fictifs)', () => {
    const { room } = createRoom({ presenceWatch: false });
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.addBots(2);
    room.start();
    assert.equal(room.watching, false);
    room.reportPresence(alice.id, { s: 'away', r: 'hidden' });
    mock.timers.tick(30_000);
    assert.equal(presenceOf(room, 'Alice').exits, 0);
    assert.equal(room.hostView().presenceLog.length, 0);
    assert.equal(room.playerView(alice).presence, null);
    assert.ok(room.hostView().players.filter((p) => p.isBot).every((p) => p.presence.state === 'present'));

    // Réactivée en cours de partie : l'absence en cours compte à partir de maintenant.
    room.applyHostAction({ type: 'updateSettings', settings: { presenceWatch: true } });
    assert.equal(room.watching, true);
    assert.equal(presenceOf(room, 'Alice').exits, 1);
    assert.deepEqual(room.playerView(alice).presence, { pinApp: false, exits: 1, awayMs: 0 });
    room.dispose();
  });

  it('signale le désépinglage de l’application Android quand l’épinglage est demandé', () => {
    const { room } = createRoom({ pinApp: true });
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.start();
    room.reportPresence(alice.id, { s: 'beat', v: true, app: true, pinned: true });
    assert.equal(presenceOf(room, 'Alice').pinned, true);
    room.reportPresence(alice.id, { s: 'beat', v: true, app: true, pinned: false });
    // Alerte ponctuelle : l'élève est toujours dans l'application, mais n'est plus épinglé.
    assert.equal(presenceOf(room, 'Alice').state, 'present');
    assert.equal(presenceOf(room, 'Alice').pinned, false);
    assert.equal(presenceOf(room, 'Alice').exits, 1);
    assert.equal(room.hostView().presenceLog.at(-1)?.reason, 'unpinned');
    room.dispose();
  });

  it('refuse les signaux mal formés (un élève ne peut pas annoncer une durée ou une absence « silencieuse »)', () => {
    assert.equal(presenceReportSchema.safeParse({ s: 'away', r: 'silent' }).success, false);
    assert.equal(presenceReportSchema.safeParse({ s: 'away', r: 'disconnected' }).success, false);
    assert.equal(presenceReportSchema.safeParse({ s: 'beat' }).success, false);
    assert.equal(presenceReportSchema.safeParse({ s: 'back', awayMs: 0 }).success, true, 'les champs inconnus sont ignorés');
    assert.equal('awayMs' in (presenceReportSchema.parse({ s: 'back', awayMs: 0 }) as object), false);
  });
});
