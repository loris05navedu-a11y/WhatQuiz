import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Quiz, QuizInput, QuizSummary, QuizVersionSummary } from '../../shared/types';
import { registerTeacher, SAMPLE_QUIZ, startTestServer, type ApiClient, type TestServer } from './helpers';

const DRAFT: QuizInput = {
  ...SAMPLE_QUIZ,
  title: 'Brouillon en cours',
  status: 'draft',
  questions: [{ ...SAMPLE_QUIZ.questions[0], text: '', answers: [{ text: '', isCorrect: false }] }],
};

describe('éditeur : brouillons, versions et partage', () => {
  let server: TestServer;
  let teacher: ApiClient;
  let colleague: ApiClient;

  before(async () => {
    server = await startTestServer();
    teacher = await registerTeacher(server);
    colleague = await registerTeacher(server, 'collegue@test.fr');
  });
  after(() => server.close());

  it('enregistre un brouillon incomplet mais refuse de le publier ou de le lancer', async () => {
    const created = await teacher.post<{ quiz: Quiz }>('/api/quizzes', DRAFT);
    assert.equal(created.status, 201);
    assert.equal(created.data.quiz.status, 'draft');
    assert.equal(created.data.quiz.visibility, 'private');
    assert.equal(created.data.quiz.accessCode, null);

    const published = await teacher.put<{ error: string }>(`/api/quizzes/${created.data.quiz.id}`, { ...DRAFT, status: 'published' });
    assert.equal(published.status, 400);

    const launch = await teacher.post<{ error: string }>('/api/games', { quizId: created.data.quiz.id, mode: 'live' });
    assert.equal(launch.status, 400);
    assert.match(launch.data.error, /Corrigez le quiz avant de le lancer/);
  });

  it('conserve les métadonnées (sous-catégorie, tags, difficulté, niveau)', async () => {
    const input: QuizInput = { ...SAMPLE_QUIZ, subcategory: 'Physique', tags: ['Révision', 'révision', ' chapitre 3 '], difficulty: 'hard', level: '4e' };
    const { data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', input);
    assert.equal(data.quiz.subcategory, 'Physique');
    assert.deepEqual(data.quiz.tags, ['Révision', 'chapitre 3']);
    assert.equal(data.quiz.difficulty, 'hard');
    assert.equal(data.quiz.level, '4e');
    const list = await teacher.get<{ quizzes: QuizSummary[] }>('/api/quizzes');
    const summary = list.data.quizzes.find((q) => q.id === data.quiz.id)!;
    assert.deepEqual(summary.tags, ['Révision', 'chapitre 3']);
  });

  it('garde un historique des versions et regroupe les enregistrements automatiques', async () => {
    const { data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', SAMPLE_QUIZ);
    const id = data.quiz.id;
    await teacher.put(`/api/quizzes/${id}?autosave=1`, { ...SAMPLE_QUIZ, title: 'Version auto 1' });
    await teacher.put(`/api/quizzes/${id}?autosave=1`, { ...SAMPLE_QUIZ, title: 'Version auto 2' });
    // Un enregistrement identique au précédent ne crée pas de version.
    await teacher.put(`/api/quizzes/${id}`, { ...SAMPLE_QUIZ, title: 'Version auto 2' });
    await teacher.put(`/api/quizzes/${id}`, { ...SAMPLE_QUIZ, title: 'Version finale' });

    const versions = await teacher.get<{ versions: QuizVersionSummary[] }>(`/api/quizzes/${id}/versions`);
    assert.equal(versions.status, 200);
    assert.deepEqual(
      versions.data.versions.map((v) => [v.title, v.reason]),
      [
        ['Version finale', 'save'],
        ['Version auto 2', 'autosave'],
        ['Quiz de test', 'save'],
      ],
    );

    const old = versions.data.versions[2];
    const loaded = await teacher.get<{ quiz: QuizInput }>(`/api/quizzes/${id}/versions/${old.id}`);
    assert.equal(loaded.data.quiz.title, 'Quiz de test');
    assert.equal(loaded.data.quiz.questions.length, 2);

    // Les versions sont privées (sans même révéler que le quiz existe).
    assert.equal((await colleague.get(`/api/quizzes/${id}/versions`)).status, 404);
    assert.equal((await colleague.get(`/api/quizzes/${id}/versions/${old.id}`)).status, 404);
  });

  it('partage un quiz publié avec un code et permet de le copier', async () => {
    const { data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', { ...SAMPLE_QUIZ, title: 'Quiz partagé', visibility: 'code' });
    const code = data.quiz.accessCode!;
    assert.match(code, /^[A-Z0-9]{6}$/);

    // Le code est conservé aux enregistrements suivants.
    const again = await teacher.put<{ quiz: Quiz }>(`/api/quizzes/${data.quiz.id}`, { ...SAMPLE_QUIZ, title: 'Quiz partagé', visibility: 'code' });
    assert.equal(again.data.quiz.accessCode, code);

    // Pas dans la bibliothèque (visibilité « code »), mais accessible avec le code, même saisi en minuscules.
    const library = await colleague.get<{ quizzes: QuizSummary[] }>('/api/quizzes/library');
    assert.equal(library.data.quizzes.some((q) => q.id === data.quiz.id), false);
    const shared = await colleague.get<{ quiz: Quiz }>(`/api/quizzes/shared/${code.toLowerCase()}`);
    assert.equal(shared.status, 200);
    assert.equal(shared.data.quiz.title, 'Quiz partagé');

    const copy = await colleague.post<{ quiz: Quiz }>(`/api/quizzes/shared/${code}/copy`);
    assert.equal(copy.status, 201);
    assert.equal(copy.data.quiz.title, 'Quiz partagé');
    assert.equal(copy.data.quiz.status, 'draft');
    assert.equal(copy.data.quiz.visibility, 'private');
    assert.equal(copy.data.quiz.accessCode, null);
    assert.equal(copy.data.quiz.questions.length, 2);
    assert.notEqual(copy.data.quiz.id, data.quiz.id);

    // Repassé en privé, le code ne donne plus accès au quiz.
    await teacher.put(`/api/quizzes/${data.quiz.id}`, { ...SAMPLE_QUIZ, visibility: 'private' });
    assert.equal((await colleague.get(`/api/quizzes/shared/${code}`)).status, 404);
  });

  it('liste les quiz publics publiés des autres professeurs dans la bibliothèque', async () => {
    await teacher.post('/api/quizzes', { ...SAMPLE_QUIZ, title: 'Public publié', visibility: 'public', status: 'published' });
    await teacher.post('/api/quizzes', { ...DRAFT, title: 'Public brouillon', visibility: 'public' });

    const library = await colleague.get<{ quizzes: (QuizSummary & { ownerName: string })[] }>('/api/quizzes/library');
    assert.deepEqual(
      library.data.quizzes.map((q) => [q.title, q.ownerName]),
      [['Public publié', 'Prof']],
    );
    // Ses propres quiz n'y figurent pas.
    const own = await teacher.get<{ quizzes: QuizSummary[] }>('/api/quizzes/library');
    assert.equal(own.data.quizzes.length, 0);
  });

  it('refuse un code invalide ou inconnu', async () => {
    assert.equal((await colleague.get('/api/quizzes/shared/ZZZZZZ')).status, 404);
    assert.equal((await colleague.get('/api/quizzes/shared/abc')).status, 404);
  });
});
