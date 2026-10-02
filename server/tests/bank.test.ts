import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { BankFolder, BankQuestion, QuestionInput, Quiz } from '../../shared/types';
import { ApiClient, registerTeacher, SAMPLE_QUIZ, startTestServer, type TestServer } from './helpers';

const [QCM, TEXT] = SAMPLE_QUIZ.questions;
const question = (text: string): QuestionInput => ({ ...QCM, text });

describe('banque de questions', () => {
  let server: TestServer;
  let teacher: ApiClient;
  let other: ApiClient;
  let ids: string[] = [];
  let folder: BankFolder;
  let sub: BankFolder;

  before(async () => {
    server = await startTestServer();
    teacher = await registerTeacher(server);
    other = await registerTeacher(server, 'autre@test.fr');
  });
  after(() => server.close());

  const bank = async (client = teacher) => (await client.get<{ questions: BankQuestion[]; folders: BankFolder[] }>('/api/bank')).data;

  it('ajoute des questions complètes et refuse les questions incomplètes', async () => {
    const created = await teacher.post<{ questions: BankQuestion[] }>('/api/bank/questions', {
      questions: [question('Alpha ?'), question('Beta ?'), TEXT],
      tags: ['calcul', 'Calcul'],
      difficulty: 'easy',
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.questions.length, 3);
    assert.deepEqual(created.data.questions[0].tags, ['calcul']);
    assert.equal(created.data.questions[0].difficulty, 'easy');
    ids = created.data.questions.map((q) => q.id);

    const incomplete = await teacher.post<{ error: string }>('/api/bank/questions', { questions: [{ ...QCM, text: '' }] });
    assert.equal(incomplete.status, 400);
    const badType = await teacher.post<{ error: string }>('/api/bank/questions', { questions: [{ ...QCM, type: 'inconnu' }] });
    assert.equal(badType.status, 400);
    assert.equal((await teacher.post('/api/bank/questions', { questions: [] })).status, 400);
    assert.equal((await teacher.post('/api/bank/questions', { questions: [question('X')], difficulty: 'extrême' })).status, 400);

    const { questions } = await bank();
    assert.equal(questions.length, 3);
  });

  it('range les questions dans des dossiers imbriqués', async () => {
    folder = (await teacher.post<{ folder: BankFolder }>('/api/bank/folders', { name: '  Fractions  ' })).data.folder;
    assert.equal(folder.name, 'Fractions');
    sub = (await teacher.post<{ folder: BankFolder }>('/api/bank/folders', { name: 'Exercices', parentId: folder.id })).data.folder;
    assert.equal(sub.parentId, folder.id);
    assert.equal((await teacher.post('/api/bank/folders', { name: '' })).status, 400);

    // Un dossier ne peut pas être rangé dans son propre sous-dossier.
    assert.equal((await teacher.put(`/api/bank/folders/${folder.id}`, { parentId: sub.id })).status, 400);

    // Profondeur limitée à 4 niveaux.
    let parent = sub.id;
    for (const name of ['N3', 'N4']) parent = (await teacher.post<{ folder: BankFolder }>('/api/bank/folders', { name, parentId: parent })).data.folder.id;
    assert.equal((await teacher.post('/api/bank/folders', { name: 'N5', parentId: parent })).status, 400);

    const moved = await teacher.post<{ count: number }>('/api/bank/bulk', { action: 'move', ids: ids.slice(0, 2), folderId: sub.id });
    assert.equal(moved.data.count, 2);
    const tagged = await teacher.post('/api/bank/bulk', { action: 'tag', ids, tags: ['révision'] });
    assert.equal(tagged.status, 200);
    const { questions } = await bank();
    assert.deepEqual(questions.filter((q) => q.folderId === sub.id).length, 2);
    assert.ok(questions.every((q) => q.tags.includes('révision')));
  });

  it('modifie une question en revalidant son contenu', async () => {
    const updated = await teacher.put<{ question: BankQuestion }>(`/api/bank/questions/${ids[0]}`, { question: question('Alpha modifiée ?'), difficulty: 'hard' });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.question.question.text, 'Alpha modifiée ?');
    assert.equal(updated.data.question.difficulty, 'hard');
    assert.equal(updated.data.question.folderId, sub.id, 'les champs non envoyés sont conservés');
    assert.equal((await teacher.put(`/api/bank/questions/${ids[0]}`, { question: { ...QCM, answers: [] } })).status, 400);
  });

  it('crée un quiz brouillon à partir d’une sélection, dans l’ordre choisi', async () => {
    const created = await teacher.post<{ quiz: Quiz }>('/api/bank/quiz', { ids: [ids[2], ids[0]], title: 'Révisions' });
    assert.equal(created.status, 201);
    assert.equal(created.data.quiz.title, 'Révisions');
    assert.equal(created.data.quiz.status, 'draft');
    assert.equal(created.data.quiz.visibility, 'private');
    assert.deepEqual(
      created.data.quiz.questions.map((q) => q.text),
      ['Capitale de la France ?', 'Alpha modifiée ?'],
    );
    const launch = await teacher.post('/api/games', { quizId: created.data.quiz.id, mode: 'live' });
    assert.equal(launch.status, 201, 'un brouillon complet peut être lancé');

    const used = await teacher.post<{ questions: QuestionInput[] }>('/api/bank/use', { ids: [ids[1]] });
    assert.deepEqual(
      used.data.questions.map((q) => q.text),
      ['Beta ?'],
    );
    const usage = Object.fromEntries((await bank()).questions.map((q) => [q.id, q.usage]));
    assert.deepEqual([usage[ids[0]], usage[ids[1]], usage[ids[2]]], [1, 1, 1]);
  });

  it('ajoute toutes les questions complètes d’un quiz', async () => {
    const { data } = await teacher.post<{ quiz: Quiz }>('/api/quizzes', {
      ...SAMPLE_QUIZ,
      title: 'Source',
      status: 'draft',
      tags: ['source'],
      questions: [...SAMPLE_QUIZ.questions, { ...QCM, text: '' }],
    });
    const added = await teacher.post<{ questions: BankQuestion[]; skipped: number }>(`/api/bank/from-quiz/${data.quiz.id}`, { folderId: folder.id });
    assert.equal(added.status, 201);
    assert.equal(added.data.questions.length, 2);
    assert.equal(added.data.skipped, 1);
    assert.equal(added.data.questions[0].source, 'Source');
    assert.deepEqual(added.data.questions[0].tags, ['source']);
    assert.equal(added.data.questions[0].folderId, folder.id);
    assert.equal((await other.post(`/api/bank/from-quiz/${data.quiz.id}`, {})).status, 404);
  });

  it('supprime un dossier en remontant son contenu', async () => {
    assert.equal((await teacher.delete(`/api/bank/folders/${sub.id}`)).status, 200);
    const { questions, folders } = await bank();
    assert.equal(questions.filter((q) => q.folderId === folder.id).length, 4);
    assert.equal(folders.find((f) => f.name === 'N3')?.parentId, folder.id);
  });

  it('isole la banque de chaque professeur et la refuse aux élèves', async () => {
    assert.equal((await bank(other)).questions.length, 0);
    assert.equal((await other.put(`/api/bank/questions/${ids[0]}`, { tags: [] })).status, 404);
    assert.equal((await other.delete(`/api/bank/questions/${ids[0]}`)).status, 404);
    assert.equal((await other.post('/api/bank/bulk', { action: 'delete', ids })).status, 404);
    assert.equal((await other.post('/api/bank/quiz', { ids })).status, 404);
    assert.equal((await other.post('/api/bank/questions', { questions: [question('X ?')], folderId: folder.id })).status, 404);

    const student = new ApiClient(server.url);
    await student.post('/api/auth/register', { email: 'eleve@test.fr', password: 'motdepasse', displayName: 'Élève', role: 'student' });
    assert.equal((await student.get('/api/bank')).status, 403);
    assert.equal((await new ApiClient(server.url).get('/api/bank')).status, 401);
  });

  it('supprime des questions (une par une ou par lot)', async () => {
    assert.equal((await teacher.delete(`/api/bank/questions/${ids[0]}`)).status, 200);
    assert.equal((await teacher.post('/api/bank/bulk', { action: 'delete', ids: ids.slice(1) })).status, 200);
    assert.equal((await bank()).questions.length, 2);
  });
});
