import { LIMITS, TIME_LIMITS } from './constants';
import type { QuestionInput, QuizInput } from './types';

/** Règles métier d'une question, partagées par l'éditeur (messages immédiats) et le serveur (autorité). */
export function questionProblem(question: QuestionInput): string | null {
  if (!question.text.trim()) return "L'énoncé est vide";
  if (!(TIME_LIMITS as readonly number[]).includes(question.timeLimit)) return 'Temps limite invalide';
  const answers = question.answers;
  const filled = answers.filter((answer) => answer.text.trim().length > 0);
  if (filled.length !== answers.length) return 'Une réponse est vide';
  const correct = answers.filter((answer) => answer.isCorrect).length;

  switch (question.type) {
    case 'single':
      if (answers.length < LIMITS.minChoices) return 'Au moins 2 réponses sont nécessaires';
      if (answers.length > LIMITS.maxChoices) return '6 réponses maximum';
      if (correct !== 1) return 'Choisissez exactement une bonne réponse';
      return null;
    case 'multiple':
      if (answers.length < LIMITS.minChoices) return 'Au moins 2 réponses sont nécessaires';
      if (answers.length > LIMITS.maxChoices) return '6 réponses maximum';
      if (correct < 1) return 'Choisissez au moins une bonne réponse';
      return null;
    case 'truefalse':
      if (answers.length !== 2) return 'Une question Vrai/Faux possède 2 réponses';
      if (correct !== 1) return 'Indiquez si la bonne réponse est Vrai ou Faux';
      return null;
    case 'text':
      if (answers.length < 1) return 'Ajoutez au moins une réponse acceptée';
      if (answers.length > LIMITS.maxAcceptedAnswers) return '10 réponses acceptées maximum';
      return null;
  }
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
