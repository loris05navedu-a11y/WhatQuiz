import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computePoints, isAnswerCorrect, normalizeText } from '../../shared/scoring';

describe('calcul du score', () => {
  const base = { correct: true, basePoints: 1000, pointsEnabled: true, timeLimitMs: 20_000 };

  it('attribue les points fixes pour une bonne réponse', () => {
    assert.equal(computePoints({ ...base, mode: 'fixed', responseMs: 15_000 }), 1000);
  });

  it('applique le bonus de rapidité (100 % → 50 %)', () => {
    assert.equal(computePoints({ ...base, mode: 'speed', responseMs: 0 }), 1000);
    assert.equal(computePoints({ ...base, mode: 'speed', responseMs: 10_000 }), 750);
    assert.equal(computePoints({ ...base, mode: 'speed', responseMs: 20_000 }), 500);
    assert.equal(computePoints({ ...base, mode: 'speed', responseMs: 99_000 }), 500);
  });

  it("ne donne rien pour une mauvaise réponse, sans score ou si les points sont désactivés", () => {
    assert.equal(computePoints({ ...base, mode: 'speed', responseMs: 0, correct: false }), 0);
    assert.equal(computePoints({ ...base, mode: 'none', responseMs: 0 }), 0);
    assert.equal(computePoints({ ...base, mode: 'fixed', responseMs: 0, pointsEnabled: false }), 0);
  });
});

describe('correction des réponses', () => {
  const qcm = { type: 'multiple' as const, answers: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }, { text: 'c', isCorrect: true }] };

  it('exige toutes les bonnes réponses et aucune mauvaise (QCM multiple)', () => {
    assert.equal(isAnswerCorrect(qcm, { kind: 'choice', choices: [2, 0] }), true);
    assert.equal(isAnswerCorrect(qcm, { kind: 'choice', choices: [0] }), false);
    assert.equal(isAnswerCorrect(qcm, { kind: 'choice', choices: [0, 1, 2] }), false);
  });

  it('tolère casse, accents et espaces pour les réponses texte', () => {
    const question = { type: 'text' as const, answers: [{ text: 'Éléphant', isCorrect: true }] };
    assert.equal(normalizeText('  ÉLÉPHANT. '), 'elephant');
    assert.equal(isAnswerCorrect(question, { kind: 'text', text: 'elephant' }), true);
    assert.equal(isAnswerCorrect(question, { kind: 'text', text: 'éléphants' }), false);
    assert.equal(isAnswerCorrect(question, { kind: 'choice', choices: [0] }), false);
  });
});
