import { CATEGORIES, DEFAULT_POINTS, DEFAULT_TIME_LIMIT, LIMITS, QUESTION_TYPES, TIME_LIMITS } from './constants';
import { quizProblems } from './quizRules';
import type { AnswerInput, QuestionInput, QuestionType, QuizInput } from './types';

export const QUIZ_FILE_FORMAT = 'whatquiz-quiz';
export const QUIZ_FILE_VERSION = 1;
export const QUIZ_FILE_EXTENSION = '.whatquiz.json';

/** Fichier d'échange d'un quiz. Les images y sont intégrées (data URL) pour rester portables. */
export interface QuizFile {
  format: typeof QUIZ_FILE_FORMAT;
  version: number;
  exportedAt: string;
  quiz: QuizInput;
}

export class QuizFileError extends Error {}

export function toQuizFile(quiz: QuizInput, now = new Date()): QuizFile {
  return {
    format: QUIZ_FILE_FORMAT,
    version: QUIZ_FILE_VERSION,
    exportedAt: now.toISOString(),
    quiz: {
      title: quiz.title,
      description: quiz.description,
      imageUrl: quiz.imageUrl,
      category: quiz.category,
      questions: quiz.questions.map((q) => ({
        type: q.type,
        text: q.text,
        imageUrl: q.imageUrl,
        timeLimit: q.timeLimit,
        points: q.points,
        pointsEnabled: q.pointsEnabled,
        answers: q.answers.map((a) => ({ text: a.text, isCorrect: a.isCorrect })),
      })),
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Seules les images intégrées ou les liens web survivent à un changement de serveur. */
function portableImage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  if (/^https?:\/\/\S+$/.test(value) && value.length <= 500) return value;
  return null;
}

function parseQuestion(raw: unknown, index: number): QuestionInput {
  if (!isRecord(raw)) throw new QuizFileError(`Question ${index + 1} illisible`);
  const type = raw.type as QuestionType;
  if (!QUESTION_TYPES.includes(type)) throw new QuizFileError(`Question ${index + 1} : type inconnu`);
  const timeLimit = (TIME_LIMITS as readonly number[]).includes(raw.timeLimit as number) ? (raw.timeLimit as number) : DEFAULT_TIME_LIMIT;
  const points = Number.isInteger(raw.points) && (raw.points as number) >= 0 && (raw.points as number) <= 5000 ? (raw.points as number) : DEFAULT_POINTS;
  const answers: AnswerInput[] = (Array.isArray(raw.answers) ? raw.answers : [])
    .filter(isRecord)
    .slice(0, LIMITS.maxAcceptedAnswers)
    .map((a) => ({ text: text(a.text, LIMITS.answerText), isCorrect: type === 'text' || a.isCorrect === true }));
  return {
    type,
    text: text(raw.text, LIMITS.questionText),
    imageUrl: portableImage(raw.imageUrl),
    timeLimit,
    points,
    pointsEnabled: raw.pointsEnabled !== false,
    answers,
  };
}

/** Lit un fichier exporté par WhatQuiz. Lève une QuizFileError au message lisible si le fichier est invalide. */
export function parseQuizFile(content: string): QuizInput {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new QuizFileError('Ce fichier n’est pas un quiz WhatQuiz');
  }
  if (!isRecord(data) || data.format !== QUIZ_FILE_FORMAT || !isRecord(data.quiz)) throw new QuizFileError('Ce fichier n’est pas un quiz WhatQuiz');
  if (typeof data.version !== 'number' || data.version > QUIZ_FILE_VERSION) {
    throw new QuizFileError('Ce fichier provient d’une version plus récente de WhatQuiz');
  }
  const raw = data.quiz;
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (questions.length > LIMITS.questionsPerQuiz) throw new QuizFileError(`${LIMITS.questionsPerQuiz} questions maximum`);
  const quiz: QuizInput = {
    title: text(raw.title, LIMITS.quizTitle),
    description: text(raw.description, LIMITS.quizDescription),
    imageUrl: portableImage(raw.imageUrl),
    category: text(raw.category, LIMITS.category) || CATEGORIES[0],
    questions: questions.map(parseQuestion),
  };
  const problems = quizProblems(quiz);
  if (problems.length > 0) throw new QuizFileError(problems[0]);
  return quiz;
}
