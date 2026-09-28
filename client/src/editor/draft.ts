import { CATEGORIES, DEFAULT_POINTS, DEFAULT_TIME_LIMIT } from '../../../shared/constants';
import type { AnswerInput, QuestionInput, QuestionType, Quiz, QuizInput } from '../../../shared/types';

/** Question en cours d'édition : une clé stable permet à React de suivre les déplacements. */
export interface DraftQuestion extends QuestionInput {
  key: string;
}

export interface DraftQuiz extends Omit<QuizInput, 'questions'> {
  questions: DraftQuestion[];
}

let counter = 0;
export const newKey = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

const emptyChoices = (count: number): AnswerInput[] => Array.from({ length: count }, () => ({ text: '', isCorrect: false }));
const trueFalse = (trueIsCorrect = true): AnswerInput[] => [
  { text: 'Vrai', isCorrect: trueIsCorrect },
  { text: 'Faux', isCorrect: !trueIsCorrect },
];

export function answersFor(type: QuestionType): AnswerInput[] {
  switch (type) {
    case 'single':
    case 'multiple':
      return emptyChoices(4);
    case 'truefalse':
      return trueFalse();
    case 'text':
      return [{ text: '', isCorrect: true }];
  }
}

export function createQuestion(type: QuestionType): DraftQuestion {
  return {
    key: newKey(),
    type,
    text: '',
    imageUrl: null,
    timeLimit: type === 'truefalse' ? 10 : type === 'text' ? 30 : DEFAULT_TIME_LIMIT,
    points: DEFAULT_POINTS,
    pointsEnabled: true,
    answers: answersFor(type),
  };
}

/** Change le type d'une question en conservant ce qui peut l'être. */
export function convertQuestion(question: DraftQuestion, type: QuestionType): DraftQuestion {
  if (question.type === type) return question;
  const wasChoice = question.type === 'single' || question.type === 'multiple';
  let answers: AnswerInput[];
  if (type === 'truefalse') answers = trueFalse();
  else if (type === 'text') answers = [{ text: wasChoice ? (question.answers.find((a) => a.isCorrect)?.text ?? '') : '', isCorrect: true }];
  else if (!wasChoice) answers = emptyChoices(4);
  else if (type === 'single') {
    const firstCorrect = question.answers.findIndex((a) => a.isCorrect);
    answers = question.answers.map((a, i) => ({ ...a, isCorrect: i === firstCorrect }));
  } else answers = question.answers;
  return { ...question, type, answers };
}

export function toDraft(quiz?: Quiz): DraftQuiz {
  if (!quiz) return { title: '', description: '', imageUrl: null, category: CATEGORIES[0], questions: [createQuestion('single')] };
  return {
    title: quiz.title,
    description: quiz.description,
    imageUrl: quiz.imageUrl,
    category: quiz.category,
    questions: quiz.questions.map(({ id: _id, position: _position, ...question }) => ({ ...question, key: newKey() })),
  };
}

export function toInput(draft: DraftQuiz): QuizInput {
  return {
    ...draft,
    title: draft.title.trim(),
    description: draft.description.trim(),
    category: draft.category.trim(),
    questions: draft.questions.map(({ key: _key, ...question }) => ({
      ...question,
      text: question.text.trim(),
      answers: question.answers.map((a) => ({ ...a, text: a.text.trim() })),
    })),
  };
}
