import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseQuizFile, QuizFileError, toQuizFile } from '../../shared/quizFile';
import { parseTextQuestions, TEXT_IMPORT_EXAMPLE } from '../../shared/textImport';
import { SAMPLE_QUIZ } from './helpers';

describe('fichier de quiz', () => {
  it('relit à l’identique un quiz exporté (champs récents complétés par leur valeur par défaut)', () => {
    const file = JSON.stringify(toQuizFile(SAMPLE_QUIZ));
    const expected = { ...SAMPLE_QUIZ, questions: SAMPLE_QUIZ.questions.map((q) => ({ ...q, explanation: '', bonus: false, media: [] })) };
    assert.deepEqual(parseQuizFile(file), expected);
  });

  it('conserve les nouveaux types, explications, bonus et réglages', () => {
    const quiz = {
      ...SAMPLE_QUIZ,
      questions: [
        { type: 'numeric' as const, text: 'Combien ?', imageUrl: null, timeLimit: 30, points: 1000, pointsEnabled: true, answers: [], explanation: 'Parce que.', bonus: true, media: [], config: { answer: 42, tolerance: 1, unit: 'cm' } },
        { type: 'match' as const, text: 'Associez', imageUrl: null, timeLimit: 60, points: 1000, pointsEnabled: true, answers: [{ text: 'Paris', isCorrect: true, match: 'France' }, { text: 'Rome', isCorrect: true, match: 'Italie' }], explanation: '', bonus: false, media: [] },
        { type: 'poll' as const, text: 'Votre avis ?', imageUrl: null, timeLimit: 20, points: 1000, pointsEnabled: true, answers: [{ text: 'Oui', isCorrect: false }, { text: 'Non', isCorrect: false }], explanation: '', bonus: false, media: [] },
      ],
    };
    assert.deepEqual(parseQuizFile(JSON.stringify(toQuizFile(quiz))), quiz);
  });

  it('refuse un fichier étranger ou d’une version future', () => {
    assert.throws(() => parseQuizFile('pas du json'), QuizFileError);
    assert.throws(() => parseQuizFile(JSON.stringify({ title: 'x' })), /pas un quiz WhatQuiz/);
    const future = { ...toQuizFile(SAMPLE_QUIZ), version: 99 };
    assert.throws(() => parseQuizFile(JSON.stringify(future)), /version plus récente/);
  });

  it('signale une question invalide et écarte les images non portables', () => {
    const file = toQuizFile(SAMPLE_QUIZ);
    file.quiz.imageUrl = '/uploads/local.png';
    file.quiz.questions[0].imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const parsed = parseQuizFile(JSON.stringify(file));
    assert.equal(parsed.imageUrl, null);
    assert.equal(parsed.questions[0].imageUrl, 'data:image/png;base64,iVBORw0KGgo=');

    file.quiz.questions[0].answers = file.quiz.questions[0].answers.map((a) => ({ ...a, isCorrect: false }));
    assert.throws(() => parseQuizFile(JSON.stringify(file)), /Question 1 : Choisissez exactement une bonne réponse/);
  });
});

describe('import de questions depuis un texte', () => {
  it('reconnaît les quatre types de questions de l’exemple', () => {
    const { questions, errors } = parseTextQuestions(TEXT_IMPORT_EXAMPLE);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      questions.map((q) => q.type),
      ['single', 'multiple', 'truefalse', 'text'],
    );
    assert.equal(questions[1].timeLimit, 30);
    assert.equal(questions[1].text, 'Quels nombres sont pairs ?');
    assert.deepEqual(questions[2].answers, [
      { text: 'Vrai', isCorrect: false },
      { text: 'Faux', isCorrect: true },
    ]);
    assert.deepEqual(questions[3].answers, [{ text: '56', isCorrect: true }]);
  });

  it('accepte plusieurs variantes, la numérotation et les fins de ligne Windows', () => {
    const { questions } = parseTextQuestions('1. Capitale du Japon ?\r\n= Tokyo | Tōkyō\r\n');
    assert.equal(questions[0].text, 'Capitale du Japon ?');
    assert.deepEqual(
      questions[0].answers.map((a) => a.text),
      ['Tokyo', 'Tōkyō'],
    );
  });

  it('explique les blocs incorrects sans bloquer les autres', () => {
    const { questions, errors } = parseTextQuestions('Sans bonne réponse ?\n- a\n- b\n\nBonne ?\n* oui\n- non\n\nDurée ? (7s)\n* a\n- b');
    assert.equal(questions.length, 2);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /Bloc 1.*Choisissez exactement une bonne réponse/);
    assert.match(errors[1], /Bloc 3 : durée 7s non disponible/);
  });
});
