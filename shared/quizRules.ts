import { LIMITS, TIME_LIMITS } from './constants';
import { QUESTION_TYPE_DEFINITIONS } from './questionTypes';
import type { QuestionInput, QuizInput } from './types';

/** Règles métier d'une question, partagées par l'éditeur (messages immédiats) et le serveur (autorité). */
export function questionProblem(question: QuestionInput): string | null {
  if (!question.text.trim()) return "L'énoncé est vide";
  if (!(TIME_LIMITS as readonly number[]).includes(question.timeLimit)) return 'Temps limite invalide';
  if ((question.explanation ?? '').length > LIMITS.explanation) return `Explication : ${LIMITS.explanation} caractères maximum`;
  const definition = QUESTION_TYPE_DEFINITIONS[question.type];
  if (!definition) return 'Type de question inconnu';
  return definition.validate(question);
}

export function quizProblems(quiz: QuizInput): string[] {
  const problems: string[] = [];
  if (!quiz.title.trim()) problems.push('Le titre du quiz est obligatoire');
  quiz.questions.forEach((question, index) => {
    const problem = questionProblem(question);
    if (problem) problems.push(`Question ${index + 1} : ${problem}`);
  });
  return problems;
}
