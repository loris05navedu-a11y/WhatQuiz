import { z } from 'zod';
import { CATEGORIES, LIMITS, QUESTION_TYPES, TIME_LIMITS } from '../../shared/constants';
import { questionProblem } from '../../shared/quizRules';

z.config(z.locales.fr());

const trimmed = (max: number) => z.string().trim().max(max);

/** URL d'image : fichier envoyé sur le serveur ou lien http(s). */
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^\/uploads\/[\w.-]+$/.test(value) || /^https?:\/\/\S+$/.test(value), 'Image invalide')
  .nullable()
  .default(null);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(160),
  password: z.string().min(LIMITS.minPassword, `Le mot de passe doit contenir au moins ${LIMITS.minPassword} caractères`).max(200),
  displayName: trimmed(LIMITS.displayName).min(1, 'Le nom est obligatoire'),
  role: z.enum(['teacher', 'student']).default('teacher'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(160),
  password: z.string().max(200),
});

export const profileSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(160),
  displayName: trimmed(LIMITS.displayName).min(1, 'Le nom est obligatoire'),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().max(200),
  newPassword: z.string().min(LIMITS.minPassword, `Le mot de passe doit contenir au moins ${LIMITS.minPassword} caractères`).max(200),
});

const answerSchema = z.object({
  text: trimmed(LIMITS.answerText),
  isCorrect: z.boolean(),
});

export const questionSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    text: trimmed(LIMITS.questionText),
    imageUrl,
    timeLimit: z.number().int().refine((value) => (TIME_LIMITS as readonly number[]).includes(value), 'Temps limite invalide'),
    points: z.number().int().min(0).max(5000),
    pointsEnabled: z.boolean(),
    answers: z.array(answerSchema).max(LIMITS.maxAcceptedAnswers),
  })
  .transform((question) =>
    question.type === 'text' ? { ...question, answers: question.answers.map((a) => ({ ...a, isCorrect: true })) } : question,
  )
  .superRefine((question, ctx) => {
    const problem = questionProblem(question);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const quizSchema = z.object({
  title: trimmed(LIMITS.quizTitle).min(1, 'Le titre du quiz est obligatoire'),
  description: trimmed(LIMITS.quizDescription).default(''),
  imageUrl,
  category: trimmed(LIMITS.category).default(CATEGORIES[0]),
  questions: z.array(questionSchema).max(LIMITS.questionsPerQuiz, `${LIMITS.questionsPerQuiz} questions maximum`),
});

export const gameSettingsSchema = z.object({
  scoringMode: z.enum(['speed', 'fixed', 'none']),
  allowAnswerChange: z.boolean(),
  allowBack: z.boolean(),
  endWhenAllAnswered: z.boolean(),
  autoRevealAnswers: z.boolean(),
  autoAdvance: z.boolean(),
  maxPlayers: z.number().int().min(1).max(LIMITS.maxPlayers),
});

export const createGameSchema = z.object({
  quizId: z.number().int().positive(),
  mode: z.enum(['live', 'test-host', 'test-player']).default('live'),
  settings: gameSettingsSchema.partial().default({}),
});

export const joinSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
  nickname: z.string(),
  token: z.string().max(100).optional(),
});

export const submittedAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), choices: z.array(z.number().int().min(0).max(LIMITS.maxChoices - 1)).max(LIMITS.maxChoices) }),
  z.object({ kind: z.literal('text'), text: z.string().max(LIMITS.answerText) }),
]);

export const answerPayloadSchema = z.object({
  questionIndex: z.number().int().min(0),
  answer: submittedAnswerSchema,
});

export const hostActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('startQuestion') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('endQuestion') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('previous') }),
  z.object({ type: z.literal('setAnswersVisible'), value: z.boolean() }),
  z.object({ type: z.literal('setLeaderboardVisible'), value: z.boolean() }),
  z.object({ type: z.literal('setResultsVisible'), value: z.boolean() }),
  z.object({ type: z.literal('setLocked'), value: z.boolean() }),
  z.object({ type: z.literal('kick'), playerId: z.string().max(100) }),
  z.object({ type: z.literal('updateSettings'), settings: gameSettingsSchema.partial() }),
  z.object({ type: z.literal('addBots'), count: z.number().int().min(1).max(LIMITS.maxBots) }),
  z.object({ type: z.literal('end') }),
]);

export const uploadSchema = z.object({
  dataUrl: z.string().max(3_000_000),
});

/** Premier message d'erreur lisible, pour l'afficher tel quel à l'utilisateur. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Données invalides';
  const [root, index] = issue.path;
  return root === 'questions' && typeof index === 'number' ? `Question ${index + 1} : ${issue.message}` : issue.message;
}
