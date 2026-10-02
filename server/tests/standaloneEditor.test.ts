import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BankFolder, BankQuestion, PublicUser, Quiz, QuizInput, QuizSummary, QuizVersionSummary } from '../../shared/types';
import { SAMPLE_QUIZ } from './helpers';

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

const { localApi } = await import('../../client/src/standalone/api');

const DRAFT: QuizInput = {
  ...SAMPLE_QUIZ,
  title: 'Brouillon local',
  status: 'draft',
  questions: [{ ...SAMPLE_QUIZ.questions[0], text: '', answers: [{ text: '', isCorrect: false }] }],
};

async function register(email: string, displayName: string) {
  await localApi('POST', '/auth/logout').catch(() => undefined);
  return (await localApi<{ user: PublicUser }>('POST', '/auth/register', { email, password: 'motdepasse1', displayName, role: 'teacher' })).user;
}

const login = (email: string) => localApi('POST', '/auth/login', { email, password: 'motdepasse1' });

describe('mode sans serveur : brouillons, versions et partage', () => {
  let sharedCode = '';

  it('enregistre un brouillon incomplet mais refuse de le publier ou de le lancer', async () => {
    await register('a@ecole.fr', 'Mme A');
    const { quiz } = await localApi<{ quiz: Quiz }>('POST', '/quizzes', DRAFT);
    assert.equal(quiz.status, 'draft');
    await assert.rejects(localApi('PUT', `/quizzes/${quiz.id}`, { ...DRAFT, status: 'published' }));
    await assert.rejects(localApi('POST', '/games', { quizId: quiz.id, mode: 'live' }), /Corrigez le quiz avant de le lancer/);
  });

  it('garde un historique des versions (enregistrements automatiques regroupés)', async () => {
    const { quiz } = await localApi<{ quiz: Quiz }>('POST', '/quizzes', SAMPLE_QUIZ);
    await localApi('PUT', `/quizzes/${quiz.id}?autosave=1`, { ...SAMPLE_QUIZ, title: 'Auto 1' });
    await localApi('PUT', `/quizzes/${quiz.id}?autosave=1`, { ...SAMPLE_QUIZ, title: 'Auto 2' });
    await localApi('PUT', `/quizzes/${quiz.id}`, { ...SAMPLE_QUIZ, title: 'Finale' });
    const { versions } = await localApi<{ versions: QuizVersionSummary[] }>('GET', `/quizzes/${quiz.id}/versions`);
    assert.deepEqual(
      versions.map((v) => [v.title, v.reason]),
      [
        ['Finale', 'save'],
        ['Auto 2', 'autosave'],
        ['Quiz de test', 'save'],
      ],
    );
    const loaded = await localApi<{ quiz: QuizInput }>('GET', `/quizzes/${quiz.id}/versions/${versions[2].id}`);
    assert.equal(loaded.quiz.title, 'Quiz de test');
  });

  it('partage un quiz avec un code et le place dans la bibliothèque des autres comptes', async () => {
    const coded = await localApi<{ quiz: Quiz }>('POST', '/quizzes', { ...SAMPLE_QUIZ, title: 'Avec code', visibility: 'code' });
    sharedCode = coded.quiz.accessCode!;
    assert.match(sharedCode, /^[A-Z0-9]{6}$/);
    await localApi('POST', '/quizzes', { ...SAMPLE_QUIZ, title: 'Public', visibility: 'public' });
    await localApi('POST', '/quizzes', { ...DRAFT, title: 'Brouillon public', visibility: 'public' });

    await register('b@ecole.fr', 'M. B');
    const { quizzes } = await localApi<{ quizzes: (QuizSummary & { ownerName: string })[] }>('GET', '/quizzes/library');
    assert.deepEqual(
      quizzes.map((q) => [q.title, q.ownerName]),
      [['Public', 'Mme A']],
    );

    const shared = await localApi<{ quiz: Quiz }>('GET', `/quizzes/shared/${sharedCode.toLowerCase()}`);
    assert.equal(shared.quiz.title, 'Avec code');
    const { quiz: copy } = await localApi<{ quiz: Quiz }>('POST', `/quizzes/shared/${sharedCode}/copy`);
    assert.equal(copy.status, 'draft');
    assert.equal(copy.visibility, 'private');
    assert.equal(copy.accessCode, null);
    const mine = await localApi<{ quizzes: QuizSummary[] }>('GET', '/quizzes');
    assert.deepEqual(
      mine.quizzes.map((q) => q.title),
      ['Avec code'],
    );
  });

  it('gère une banque de questions locale (dossiers, quiz depuis la sélection)', async () => {
    const { folder } = await localApi<{ folder: BankFolder }>('POST', '/bank/folders', { name: 'Géographie' });
    const { questions } = await localApi<{ questions: BankQuestion[] }>('POST', '/bank/questions', { questions: SAMPLE_QUIZ.questions, folderId: folder.id });
    assert.equal(questions.length, 2);
    await assert.rejects(localApi('POST', '/bank/questions', { questions: [{ ...SAMPLE_QUIZ.questions[0], text: '' }] }), /énoncé/i);
    const { quiz } = await localApi<{ quiz: Quiz }>('POST', '/bank/quiz', { ids: questions.map((q) => q.id).reverse(), title: 'Depuis la banque' });
    assert.deepEqual(
      quiz.questions.map((q) => q.text),
      ['Capitale de la France ?', '2 + 2 ?'],
    );
    await localApi('DELETE', `/bank/folders/${folder.id}`);
    const bank = await localApi<{ questions: BankQuestion[]; folders: BankFolder[] }>('GET', '/bank');
    assert.equal(bank.folders.length, 0);
    assert.ok(bank.questions.every((q) => q.folderId === null && q.usage === 1));
  });

  it('ne permet pas à un autre compte de modifier ou de voir les versions du quiz partagé', async () => {
    const { quizzes } = await localApi<{ quizzes: QuizSummary[] }>('GET', '/quizzes/library');
    await assert.rejects(localApi('PUT', `/quizzes/${quizzes[0].id}`, SAMPLE_QUIZ));
    await assert.rejects(localApi('GET', `/quizzes/${quizzes[0].id}/versions`));
    await login('a@ecole.fr').catch(() => undefined);
  });
});
