import { CATEGORIES, DEFAULT_POINTS } from '../../../shared/constants';
import { normalizeQuestion, questionType } from '../../../shared/questionTypes';
import type { QuestionInput, QuestionType, Quiz, QuizInput } from '../../../shared/types';
import { CHOICE_TYPES, ORDER_TYPES } from '../questionTypes/meta';

/** Question en cours d'édition : une clé stable permet à React de suivre les déplacements. */
export interface DraftQuestion extends QuestionInput {
  key: string;
}

export interface DraftQuiz extends Omit<QuizInput, 'questions'> {
  questions: DraftQuestion[];
}

let counter = 0;
export const newKey = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

export function answersFor(type: QuestionType) {
  return questionType(type).createAnswers();
}

export function createQuestion(type: QuestionType): DraftQuestion {
  const definition = questionType(type);
  const config = definition.createConfig?.();
  return {
    key: newKey(),
    type,
    text: '',
    imageUrl: null,
    timeLimit: definition.defaultTimeLimit,
    points: DEFAULT_POINTS,
    pointsEnabled: true,
    answers: definition.createAnswers(),
    explanation: '',
    bonus: false,
    media: [],
    ...(config ? { config } : {}),
  };
}

/** Change le type d'une question en conservant ce qui peut l'être (énoncé, médias, textes des choix…). */
export function convertQuestion(question: DraftQuestion, type: QuestionType): DraftQuestion {
  if (question.type === type) return question;
  const fresh = createQuestion(type);
  const texts = question.answers.map((a) => a.text).filter((t) => t.trim());
  let answers = fresh.answers;
  if (type === 'truefalse') answers = fresh.answers;
  else if (type === 'text') answers = [{ text: question.answers.find((a) => a.isCorrect && a.text.trim())?.text ?? '', isCorrect: true }];
  else if ((CHOICE_TYPES.has(type) || ORDER_TYPES.has(type)) && (CHOICE_TYPES.has(question.type) || ORDER_TYPES.has(question.type)) && question.type !== 'truefalse') {
    // QCM ↔ sondage ↔ ordre : les textes des choix sont gardés (la bonne réponse unique est conservée si possible).
    const firstCorrect = question.answers.findIndex((a) => a.isCorrect);
    answers = question.answers.map((a, i) => ({ text: a.text, isCorrect: type === 'multiple' ? a.isCorrect : type === 'single' ? i === Math.max(firstCorrect, 0) : true }));
  } else if (type === 'match' && texts.length >= 2) answers = texts.slice(0, 6).map((text) => ({ text, isCorrect: true, match: '' }));
  return {
    ...fresh,
    key: question.key,
    text: question.text,
    imageUrl: question.imageUrl,
    media: question.media ?? [],
    explanation: question.explanation ?? '',
    bonus: question.bonus ?? false,
    points: question.points,
    pointsEnabled: question.pointsEnabled,
    answers: normalizeQuestion({ ...fresh, answers }).answers,
  };
}

export function toDraft(quiz?: Quiz): DraftQuiz {
  if (!quiz) return { title: '', description: '', imageUrl: null, category: CATEGORIES[0], questions: [createQuestion('single')] };
  return {
    title: quiz.title,
    description: quiz.description,
    imageUrl: quiz.imageUrl,
    category: quiz.category,
    questions: quiz.questions.map(({ id: _id, position: _position, ...question }) => ({ explanation: '', bonus: false, media: [], ...question, key: newKey() })),
  };
}

export function toInput(draft: DraftQuiz): QuizInput {
  return {
    ...draft,
    title: draft.title.trim(),
    description: draft.description.trim(),
    category: draft.category.trim(),
    questions: draft.questions.map(({ key: _key, ...question }) =>
      normalizeQuestion({
        ...question,
        text: question.text.trim(),
        explanation: (question.explanation ?? '').trim(),
        answers: question.answers.map((a) => ({ ...a, text: a.text.trim(), ...(a.match !== undefined ? { match: a.match.trim() } : {}) })),
      }),
    ),
  };
}
