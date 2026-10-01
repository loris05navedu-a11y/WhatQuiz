import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { QUESTION_TYPES } from '../../shared/constants';
import { gradeAnswer, normalizeQuestion, questionType, QUESTION_TYPE_DEFINITIONS, shuffledIndexes } from '../../shared/questionTypes';
import { questionProblem } from '../../shared/quizRules';
import { pointsForGrade } from '../../shared/scoring';
import type { AckResult, GameResults, HostAction, PlayerView, QuestionInput, Quiz, QuizInput } from '../../shared/types';
import { Database } from '../src/db/database';
import { QuizRepository } from '../src/db/quizzes';
import { MIGRATIONS } from '../src/db/schema';
import { connectSocket, nextEvent, registerTeacher, startTestServer, type ApiClient, type TestServer, type TestSocket } from './helpers';

const base = { imageUrl: null, timeLimit: 30, points: 1000, pointsEnabled: true, explanation: '', bonus: false, media: [] };
const q = (input: Partial<QuestionInput> & Pick<QuestionInput, 'type' | 'answers'>): QuestionInput => ({ ...base, text: 'Question', ...input });

const ORDER = q({ type: 'order', answers: ['Un', 'Deux', 'Trois', 'Quatre'].map((text) => ({ text, isCorrect: true })) });
const MATCH = q({
  type: 'match',
  answers: [
    { text: 'Paris', isCorrect: true, match: 'France' },
    { text: 'Rome', isCorrect: true, match: 'Italie' },
    { text: 'Berlin', isCorrect: true, match: 'Allemagne' },
  ],
});
const NUMERIC = q({ type: 'numeric', answers: [], config: { answer: 42, tolerance: 0.5, unit: 'cm' } });
const SLIDER = q({ type: 'slider', answers: [], config: { min: 0, max: 100, step: 5, answer: 70, tolerance: 5 } });
const POLL = q({ type: 'poll', answers: [{ text: 'Oui', isCorrect: false }, { text: 'Non', isCorrect: false }] });

describe('registre des types de questions', () => {
  it('décrit tous les types, avec un libellé et des réponses par défaut', () => {
    for (const type of QUESTION_TYPES) {
      const definition = QUESTION_TYPE_DEFINITIONS[type];
      assert.equal(definition.type, type);
      assert.ok(definition.label && definition.description);
      assert.ok(Array.isArray(definition.createAnswers()));
    }
  });

  it('valide chaque type avec des messages lisibles', () => {
    assert.equal(questionProblem(ORDER), null);
    assert.equal(questionProblem(MATCH), null);
    assert.equal(questionProblem(NUMERIC), null);
    assert.equal(questionProblem(SLIDER), null);
    assert.equal(questionProblem(POLL), null);
    assert.equal(questionProblem(q({ type: 'wordcloud', answers: [] })), null);
    assert.match(questionProblem(q({ type: 'numeric', answers: [] }))!, /réponse attendue/);
    assert.match(questionProblem({ ...SLIDER, config: { ...SLIDER.config, answer: 150 } })!, /entre le minimum et le maximum/);
    assert.match(questionProblem({ ...MATCH, answers: [MATCH.answers[0], { ...MATCH.answers[1], match: 'france' }] })!, /identiques/);
    assert.match(questionProblem({ ...ORDER, answers: [ORDER.answers[0]] })!, /Au moins 2/);
    assert.match(questionProblem(q({ type: 'single', answers: [], explanation: 'x'.repeat(501) }))!, /Explication/);
  });

  it('corrige l’ordre et les associations avec un crédit partiel', () => {
    assert.deepEqual(gradeAnswer(ORDER, { kind: 'order', order: [0, 1, 2, 3] }), { correct: true, ratio: 1 });
    assert.deepEqual(gradeAnswer(ORDER, { kind: 'order', order: [0, 1, 3, 2] }), { correct: false, ratio: 0.5 });
    assert.deepEqual(gradeAnswer(ORDER, { kind: 'order', order: [0, 0, 1, 2] }), { correct: false, ratio: 0 }, 'un élément répété est refusé');
    assert.deepEqual(gradeAnswer(MATCH, { kind: 'match', pairs: [0, 2, 1] }), { correct: false, ratio: 1 / 3 });
    assert.equal(pointsForGrade({ correct: false, ratio: 0.5 }, { basePoints: 1000, pointsEnabled: true, mode: 'fixed', responseMs: 0, timeLimitMs: 1000 }), 500);
    assert.equal(pointsForGrade({ correct: true, ratio: 1 }, { basePoints: 1000, pointsEnabled: true, mode: 'fixed', responseMs: 0, timeLimitMs: 1000, bonus: true }), 2000);
  });

  it('accepte une marge d’erreur pour les nombres et les curseurs', () => {
    assert.equal(gradeAnswer(NUMERIC, { kind: 'number', value: 42.4 }).correct, true);
    assert.equal(gradeAnswer(NUMERIC, { kind: 'number', value: 43 }).correct, false);
    assert.equal(gradeAnswer(SLIDER, { kind: 'number', value: 75 }).correct, true);
    assert.equal(gradeAnswer(SLIDER, { kind: 'number', value: 120 }).correct, false, 'hors des bornes : refusé');
  });

  it('n’attribue rien aux sondages et nuages de mots', () => {
    assert.deepEqual(gradeAnswer(POLL, { kind: 'choice', choices: [0] }), { correct: false, ratio: 0 });
    assert.equal(questionType('poll').scored, false);
    assert.equal(questionType('wordcloud').scored, false);
    assert.equal(questionType('ranking').scored, false);
  });

  it('convertit la réponse affichée (mélangée) en réponse de référence, et inversement', () => {
    const definition = questionType('order');
    const layout = { items: [2, 0, 3, 1] };
    // L'élève voit : Trois, Un, Quatre, Deux. Il remet dans l'ordre : Un(1), Deux(3), Trois(0), Quatre(2).
    assert.deepEqual(definition.publicPart(ORDER, layout).choices, ['Trois', 'Un', 'Quatre', 'Deux']);
    const accepted = definition.accept({ kind: 'order', order: [1, 3, 0, 2] }, ORDER, layout)!;
    assert.deepEqual(accepted, { kind: 'order', order: [0, 1, 2, 3] });
    assert.deepEqual(definition.grade(ORDER, accepted), { correct: true, ratio: 1 });
    assert.deepEqual(definition.toDisplay(accepted, layout), { kind: 'order', order: [1, 3, 0, 2] });
    assert.deepEqual(definition.correction(ORDER, layout).correctOrder, [1, 3, 0, 2]);
  });

  it('mélange sans jamais donner la réponse d’avance', () => {
    let seed = 0;
    const alwaysZero = () => (seed++ % 2 === 0 ? 0.999 : 0.001);
    for (let n = 2; n <= 8; n++) assert.notDeepEqual(shuffledIndexes(n, alwaysZero, true), [...Array(n).keys()]);
    const layout = questionType('match').layout(MATCH, Math.random, false);
    assert.notDeepEqual(layout.options, [0, 1, 2]);
  });

  it('normalise les réponses selon le type', () => {
    assert.equal(normalizeQuestion({ ...POLL, answers: [{ text: 'A', isCorrect: true }] }).answers[0].isCorrect, false);
    assert.equal(normalizeQuestion({ ...ORDER, answers: [{ text: 'A', isCorrect: false }] }).answers[0].isCorrect, true);
    assert.equal(normalizeQuestion({ ...POLL, config: { answer: 3 } }).config, undefined);
  });
});

describe('migration de la base (types de questions extensibles)', () => {
  it('conserve les quiz créés avant la mise à jour', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'whatquiz-migration-')), 'old.db');
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON;');
    old.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY)');
    old.exec(MIGRATIONS[0] as string);
    old.exec('INSERT INTO migrations (version) VALUES (1)');
    old.exec("INSERT INTO users (email, password_hash, display_name, role) VALUES ('a@b.fr', 'x', 'Prof', 'teacher')");
    old.exec("INSERT INTO quizzes (owner_id, title) VALUES (1, 'Ancien quiz')");
    old.exec("INSERT INTO questions (quiz_id, position, type, text, time_limit, points) VALUES (1, 0, 'single', 'Capitale ?', 20, 1000)");
    old.exec("INSERT INTO answers (question_id, position, text, is_correct) VALUES (1, 0, 'Paris', 1), (1, 1, 'Lyon', 0)");
    old.close();

    const db = new Database(file);
    const quiz = new QuizRepository(db).findById(1)!;
    assert.equal(quiz.title, 'Ancien quiz');
    assert.deepEqual(quiz.questions[0].answers, [
      { text: 'Paris', isCorrect: true },
      { text: 'Lyon', isCorrect: false },
    ]);
    // Le nouveau type est maintenant accepté par la base, et la suppression en cascade fonctionne toujours.
    const created = new QuizRepository(db).create(1, { title: 'Nouveau', description: '', imageUrl: null, category: 'Autre', questions: [MATCH, NUMERIC] });
    assert.equal(created.questions[0].answers[1].match, 'Italie');
    assert.deepEqual(created.questions[1].config, NUMERIC.config);
    new QuizRepository(db).delete(created.id);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM answers')!.n, 2);
    db.close();
  });
});

function emitAck<T extends object = object>(socket: TestSocket, event: string, payload: unknown) {
  return new Promise<AckResult<T>>((resolve) => {
    (socket.emit as (event: string, payload: unknown, ack: (r: AckResult<T>) => void) => void)(event, payload, resolve);
  });
}

describe('partie en direct avec les nouveaux types', () => {
  let server: TestServer;
  let teacher: ApiClient;
  let host: TestSocket;
  let player: TestSocket;
  let gameId: string;

  const quiz: QuizInput = {
    title: 'Nouveaux types',
    description: '',
    imageUrl: null,
    category: 'Autre',
    questions: [ORDER, MATCH, { ...NUMERIC, bonus: true, explanation: '42, bien sûr.' }, POLL, q({ type: 'wordcloud', answers: [] })],
  };

  before(async () => {
    server = await startTestServer();
    teacher = await registerTeacher(server);
  });

  after(async () => {
    host?.disconnect();
    player?.disconnect();
    await server.close();
  });

  const act = (action: HostAction) => emitAck(host, 'host:action', action);

  async function playQuestion(answer: (view: PlayerView) => unknown): Promise<PlayerView> {
    const shown = nextEvent(player, 'game:state', (view) => view.phase === 'question');
    assert.equal((await act({ type: 'startQuestion' })).ok, true);
    const view = await shown;
    const revealed = nextEvent(player, 'game:state', (v) => v.phase === 'reveal' && v.outcome !== null);
    const result = await emitAck(player, 'game:answer', { questionIndex: view.questionIndex, answer: answer(view) });
    assert.equal(result.ok, true, JSON.stringify(result));
    return revealed;
  }

  it('enregistre le quiz et le relit à l’identique', async () => {
    const { status, data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', quiz);
    assert.equal(status, 201, JSON.stringify(data));
    assert.equal(data.quiz.questions[2].explanation, '42, bien sûr.');
    assert.equal(data.quiz.questions[2].bonus, true);
    const created = await teacher.post<{ gameId: string; code: string }>('/api/games', { quizId: data.quiz.id, mode: 'live', settings: { scoringMode: 'fixed' } });
    gameId = created.data.gameId;
    host = await connectSocket(server, teacher.cookie);
    assert.equal((await emitAck(host, 'host:join', { code: created.data.code })).ok, true);
    player = await connectSocket(server);
    assert.equal((await emitAck(player, 'game:join', { code: created.data.code, nickname: 'Léa' })).ok, true);
    assert.equal((await act({ type: 'start' })).ok, true);
  });

  it('ordre : l’élève voit les éléments mélangés et répond dans l’ordre affiché', async () => {
    const view = await playQuestion((v) => {
      assert.notDeepEqual(v.question!.choices, ['Un', 'Deux', 'Trois', 'Quatre']);
      return { kind: 'order', order: ['Un', 'Deux', 'Trois', 'Quatre'].map((text) => v.question!.choices.indexOf(text)) };
    });
    assert.deepEqual(view.outcome, { answered: true, correct: true, points: 1000, scored: true, ratio: 1 });
    assert.equal(view.correction!.correctOrder!.map((i) => view.question!.choices[i]).join(','), 'Un,Deux,Trois,Quatre');
  });

  it('association : une paire sur trois juste donne un tiers des points', async () => {
    assert.equal((await act({ type: 'next' })).ok, true);
    const view = await playQuestion((v) => {
      const options = v.question!.options!;
      // Paris ↔ France (juste), Rome ↔ Allemagne, Berlin ↔ Italie (faux).
      return { kind: 'match', pairs: [options.indexOf('France'), options.indexOf('Allemagne'), options.indexOf('Italie')] };
    });
    assert.deepEqual(view.outcome, { answered: true, correct: false, points: 333, scored: true, ratio: 1 / 3 });
  });

  it('numérique bonus : marge d’erreur, points doublés et explication', async () => {
    assert.equal((await act({ type: 'next' })).ok, true);
    const view = await playQuestion((v) => {
      assert.equal(v.question!.bonus, true);
      assert.equal(v.question!.unit, 'cm');
      return { kind: 'number', value: 42.5 };
    });
    assert.deepEqual(view.outcome, { answered: true, correct: true, points: 2000, scored: true, ratio: 1 });
    assert.equal(view.correction!.explanation, '42, bien sûr.');
    assert.deepEqual(view.correction!.correctValue, { answer: 42, tolerance: 0.5 });
  });

  it('sondage et nuage de mots : réponses comptées sans points', async () => {
    assert.equal((await act({ type: 'next' })).ok, true);
    const hostStats = nextEvent(host, 'host:state', (v) => v.phase === 'reveal');
    const poll = await playQuestion(() => ({ kind: 'choice', choices: [1] }));
    assert.deepEqual(poll.outcome, { answered: true, correct: false, points: 0, scored: false, ratio: 0 });
    assert.deepEqual((await hostStats).stats, { kind: 'choices', counts: [0, 1] });

    assert.equal((await act({ type: 'next' })).ok, true);
    const cloudStats = nextEvent(host, 'host:state', (v) => v.phase === 'reveal');
    await playQuestion(() => ({ kind: 'text', text: '  Super  ' }));
    const stats = (await cloudStats).stats;
    assert.equal(stats?.kind, 'texts');
    assert.equal(stats?.kind === 'texts' && stats.items[0].text, 'Super');
  });

  it('refuse une réponse mal formée sans planter la partie', async () => {
    const result = await emitAck(player, 'game:answer', { questionIndex: 4, answer: { kind: 'order', order: [0, 0] } });
    assert.equal(result.ok, false);
  });

  it('exclut les questions sans bonne réponse du taux de réussite', async () => {
    assert.equal((await act({ type: 'end' })).ok, true);
    const { data } = await teacher.get<{ results: GameResults }>(`/api/games/${gameId}/results`);
    // 3 questions notées : ordre juste, association fausse, numérique juste → 2/3.
    assert.equal(Math.round(data.results.game.successRate! * 100), 67);
    assert.deepEqual(
      data.results.questions.map((s) => s.scored),
      [true, true, true, false, false],
    );
    assert.equal(data.results.players[0].score, 1000 + 333 + 2000);
  });
});
