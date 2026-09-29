import { DEFAULT_POINTS, LIMITS, TIME_LIMITS } from './constants';
import { questionProblem } from './quizRules';
import type { AnswerInput, QuestionInput } from './types';

export const TEXT_IMPORT_EXAMPLE = `Quelle est la capitale de l'Italie ?
* Rome
- Milan
- Naples

Quels nombres sont pairs ? (30s)
* 4
- 7
* 10

La Lune est une planète.
= Faux

Combien font 7 × 8 ?
= 56`;

export interface TextImportResult {
  questions: QuestionInput[];
  errors: string[];
}

const TRUE_WORDS = ['vrai', 'true', 'v'];
const FALSE_WORDS = ['faux', 'false', 'f'];

/**
 * Transforme un texte simple en questions. Blocs séparés par une ligne vide :
 * 1re ligne = énoncé (durée optionnelle « (30s) »), « * » bonne réponse, « - » mauvaise,
 * « = » réponse attendue (Vrai/Faux ou réponse libre, variantes séparées par « | »).
 */
export function parseTextQuestions(input: string): TextImportResult {
  const questions: QuestionInput[] = [];
  const errors: string[] = [];
  const blocks = input
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);

  blocks.forEach((lines, index) => {
    const label = `Bloc ${index + 1}`;
    if (questions.length >= LIMITS.questionsPerQuiz) {
      errors.push(`${label} : ${LIMITS.questionsPerQuiz} questions maximum`);
      return;
    }
    let [statement] = lines;
    let timeLimit: number | null = null;
    const timeMatch = /\s*[([]\s*(\d+)\s*s(?:ec(?:ondes?)?)?\s*[)\]]\s*$/i.exec(statement);
    if (timeMatch) {
      const seconds = Number(timeMatch[1]);
      if ((TIME_LIMITS as readonly number[]).includes(seconds)) timeLimit = seconds;
      else errors.push(`${label} : durée ${seconds}s non disponible (choix : ${TIME_LIMITS.join(', ')})`);
      statement = statement.slice(0, timeMatch.index);
    }
    statement = statement.replace(/^(?:q?\d+\s*[.)-]\s*)/i, '').trim().slice(0, LIMITS.questionText);

    const choices: AnswerInput[] = [];
    const expected: string[] = [];
    for (const line of lines.slice(1)) {
      const marker = line[0];
      const value = line.slice(1).trim().slice(0, LIMITS.answerText);
      if (marker === '*' || marker === '+') choices.push({ text: value, isCorrect: true });
      else if (marker === '-') choices.push({ text: value, isCorrect: false });
      else if (marker === '=') expected.push(...value.split('|').map((v) => v.trim()).filter(Boolean));
      else errors.push(`${label} : ligne ignorée « ${line.slice(0, 40)} » (commencez par *, - ou =)`);
    }

    let question: QuestionInput;
    if (expected.length > 0 && choices.length === 0) {
      const single = expected.length === 1 ? expected[0].toLowerCase() : '';
      if (TRUE_WORDS.includes(single) || FALSE_WORDS.includes(single)) {
        const isTrue = TRUE_WORDS.includes(single);
        question = build('truefalse', statement, timeLimit ?? 10, [
          { text: 'Vrai', isCorrect: isTrue },
          { text: 'Faux', isCorrect: !isTrue },
        ]);
      } else {
        const accepted = expected.slice(0, LIMITS.maxAcceptedAnswers).map((text) => ({ text: text.slice(0, LIMITS.answerText), isCorrect: true }));
        question = build('text', statement, timeLimit ?? 30, accepted);
      }
    } else if (expected.length > 0) {
      errors.push(`${label} : mélange de « = » et de choix`);
      return;
    } else {
      const correct = choices.filter((c) => c.isCorrect).length;
      const isTrueFalse =
        choices.length === 2 && choices.every((c) => TRUE_WORDS.includes(c.text.toLowerCase()) || FALSE_WORDS.includes(c.text.toLowerCase()));
      if (isTrueFalse) {
        const trueIsCorrect = choices.some((c) => c.isCorrect && TRUE_WORDS.includes(c.text.toLowerCase()));
        question = build('truefalse', statement, timeLimit ?? 10, [
          { text: 'Vrai', isCorrect: trueIsCorrect },
          { text: 'Faux', isCorrect: !trueIsCorrect },
        ]);
      } else {
        question = build(correct > 1 ? 'multiple' : 'single', statement, timeLimit ?? 20, choices);
      }
    }

    const problem = questionProblem(question);
    if (problem) errors.push(`${label}${statement ? ` (« ${statement.slice(0, 40)} »)` : ''} : ${problem}`);
    else questions.push(question);
  });

  return { questions, errors };
}

function build(type: QuestionInput['type'], text: string, timeLimit: number, answers: AnswerInput[]): QuestionInput {
  return { type, text, imageUrl: null, timeLimit, points: DEFAULT_POINTS, pointsEnabled: true, answers };
}
