import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { DEFAULT_GAME_SETTINGS } from '../../shared/constants';
import { GameRoom, type RoomTransport } from '../src/game/GameRoom';
import { SAMPLE_QUIZ } from './helpers';

const silent: RoomTransport = { sendHost() {}, sendPlayer() {}, kicked() {} };

function createRoom() {
  return new GameRoom({
    id: 'g1',
    code: '123456',
    hostUserId: 1,
    snapshot: { quizId: 1, title: 'T', questions: SAMPLE_QUIZ.questions },
    settings: { ...DEFAULT_GAME_SETTINGS, scoringMode: 'speed' },
    isTest: true,
    store: null,
    transport: silent,
  });
}

describe('minuteur serveur', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  it('termine la question à la fin du temps et refuse les réponses tardives', () => {
    const room = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.join({ nickname: 'Bob', userId: null, socketId: 's2' });
    room.start();
    room.startQuestion();

    mock.timers.tick(5_000);
    room.answer(alice.id, 0, { kind: 'choice', choices: [1] });
    // Bonus de rapidité : 5 s sur 20 s ⇒ 1000 × (1 − 0,25/2) = 875 points.
    assert.equal(alice.answers.get(0)?.points, 875);

    mock.timers.tick(15_000);
    assert.equal(room.phase, 'reveal');
    assert.equal(alice.score, 875);
  });

  it('gèle le temps restant pendant une pause', () => {
    const room = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.start();
    room.startQuestion();
    mock.timers.tick(4_000);
    room.pause();
    mock.timers.tick(60_000);
    assert.equal(room.phase, 'question');
    assert.equal(room.hostView().timer?.remainingMs, 16_000);
    room.resume();
    mock.timers.tick(2_000);
    room.answer(alice.id, 0, { kind: 'choice', choices: [1] });
    // Le temps de pause n'est pas compté : réponse à 6 s.
    assert.equal(alice.answers.get(0)?.responseMs, 6_000);
    mock.timers.tick(14_000);
    assert.equal(room.phase, 'reveal');
  });

  it('refuse une réponse arrivée après la fin du temps', () => {
    const room = createRoom();
    const alice = room.join({ nickname: 'Alice', userId: null, socketId: 's1' });
    room.start();
    room.startQuestion();
    mock.timers.tick(20_000);
    assert.throws(() => room.answer(alice.id, 0, { kind: 'choice', choices: [1] }), /Le temps est écoulé/);
  });
});
