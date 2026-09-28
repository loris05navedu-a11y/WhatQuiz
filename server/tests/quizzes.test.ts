import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Quiz } from '../../shared/types';
import { registerTeacher, SAMPLE_QUIZ, startTestServer, type ApiClient, type TestServer } from './helpers';

describe('quiz', () => {
  let server: TestServer;
  let teacher: ApiClient;
  let quizId: number;

  before(async () => {
    server = await startTestServer();
    teacher = await registerTeacher(server);
  });
  after(() => server.close());

  it('crée un quiz avec ses questions', async () => {
    const { status, data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', SAMPLE_QUIZ);
    assert.equal(status, 201);
    assert.equal(data.quiz.questions.length, 2);
    assert.deepEqual(data.quiz.questions[0].answers.map((a) => a.isCorrect), [false, true]);
    quizId = data.quiz.id;
  });

  it('valide les questions côté serveur', async () => {
    const invalid = structuredClone(SAMPLE_QUIZ);
    invalid.questions[0].answers = invalid.questions[0].answers.map((a) => ({ ...a, isCorrect: false }));
    const { status, data } = await teacher.post<{ error: string }>('/api/quizzes', invalid);
    assert.equal(status, 400);
    assert.equal(data.error, 'Question 1 : Choisissez exactement une bonne réponse');

    const badTime = structuredClone(SAMPLE_QUIZ);
    badTime.questions[0].timeLimit = 7;
    assert.equal((await teacher.post('/api/quizzes', badTime)).status, 400);
  });

  it('modifie, liste, duplique et supprime un quiz', async () => {
    const update = { ...SAMPLE_QUIZ, title: 'Nouveau titre', questions: [SAMPLE_QUIZ.questions[1]] };
    const updated = await teacher.put<{ quiz: Quiz }>(`/api/quizzes/${quizId}`, update);
    assert.equal(updated.data.quiz.title, 'Nouveau titre');
    assert.equal(updated.data.quiz.questions.length, 1);

    const copy = await teacher.post<{ quiz: Quiz }>(`/api/quizzes/${quizId}/duplicate`);
    assert.equal(copy.data.quiz.title, 'Nouveau titre (copie)');

    const list = await teacher.get<{ quizzes: { id: number; questionCount: number }[] }>('/api/quizzes');
    assert.equal(list.data.quizzes.length, 2);

    assert.equal((await teacher.delete(`/api/quizzes/${copy.data.quiz.id}`)).status, 200);
    assert.equal((await teacher.get(`/api/quizzes/${copy.data.quiz.id}`)).status, 404);
  });

  it("interdit l'accès au quiz d'un autre professeur", async () => {
    const other = await registerTeacher(server, 'autre@test.fr');
    assert.equal((await other.get(`/api/quizzes/${quizId}`)).status, 403);
    assert.equal((await other.put(`/api/quizzes/${quizId}`, SAMPLE_QUIZ)).status, 403);
    assert.equal((await other.delete(`/api/quizzes/${quizId}`)).status, 403);
  });
});
