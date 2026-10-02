import { REPORTABLE_REASONS, type AwayReason } from '../../shared/presence';
import { z } from 'zod';
import { CATEGORIES, LIMITS, QUESTION_TYPES, TIME_LIMITS } from '../../shared/constants';
import { isValidMediaUrl, LOCAL_ASSET, MAX_MEDIA_PER_QUESTION } from '../../shared/media';
import { normalizeQuestion } from '../../shared/questionTypes';
import { cleanTags } from '../../shared/quizMeta';
import { questionProblem } from '../../shared/quizRules';

z.config(z.locales.fr());

const trimmed = (max: number) => z.string().trim().max(max);

const EMBEDDED_IMAGE = /^data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+$/;

/** URL d'image : fichier envoyé sur le serveur ou lien http(s) ; image intégrée (data URL) en mode sans serveur. */
const imageUrlSchema = (allowEmbedded: boolean) =>
  z
    .string()
    .trim()
    .max(allowEmbedded ? 3_000_000 : 500)
    .refine(
      (value) =>
        /^\/uploads\/[\w.-]+$/.test(value) ||
        (/^https?:\/\/\S+$/.test(value) && value.length <= 500) ||
        (allowEmbedded && (EMBEDDED_IMAGE.test(value) || LOCAL_ASSET.test(value))),
      'Image invalide',
    )
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
  match: trimmed(LIMITS.answerText).optional(),
});

const finiteNumber = z.number().finite().min(-1e12).max(1e12);

/** Réglages des questions numériques et curseurs (cohérence vérifiée par shared/questionTypes). */
const configSchema = z
  .object({
    answer: finiteNumber.optional(),
    tolerance: finiteNumber.min(0).optional(),
    unit: trimmed(LIMITS.unit).optional(),
    min: finiteNumber.optional(),
    max: finiteNumber.optional(),
    step: finiteNumber.positive().optional(),
  })
  .optional();

const mediaSchema = (allowLocal: boolean) =>
  z
    .array(z.object({ kind: z.enum(['image', 'audio', 'video']), url: z.string().trim().max(allowLocal ? 3_000_000 : 500) }))
    .max(MAX_MEDIA_PER_QUESTION, `${MAX_MEDIA_PER_QUESTION} médias maximum par question`)
    .refine((items) => items.every((item) => isValidMediaUrl(item, allowLocal)), 'Média invalide')
    .default([]);

const buildQuestionSchema = (allowEmbedded: boolean) =>
  z
    .object({
      type: z.enum(QUESTION_TYPES),
      text: trimmed(LIMITS.questionText),
      imageUrl: imageUrlSchema(allowEmbedded),
      timeLimit: z.number().int().refine((value) => (TIME_LIMITS as readonly number[]).includes(value), 'Temps limite invalide'),
      points: z.number().int().min(0).max(5000),
      pointsEnabled: z.boolean(),
      answers: z.array(answerSchema).max(LIMITS.maxAcceptedAnswers),
      explanation: trimmed(LIMITS.explanation).default(''),
      bonus: z.boolean().default(false),
      media: mediaSchema(allowEmbedded),
      config: configSchema,
    })
    .transform((question) => normalizeQuestion(question));

const buildQuizSchema = (allowEmbedded: boolean) => {
  const imageUrl = imageUrlSchema(allowEmbedded);
  const questionSchema = buildQuestionSchema(allowEmbedded);
  return z
    .object({
      title: trimmed(LIMITS.quizTitle).min(1, 'Le titre du quiz est obligatoire'),
      description: trimmed(LIMITS.quizDescription).default(''),
      imageUrl,
      category: trimmed(LIMITS.category).default(CATEGORIES[0]),
      questions: z.array(questionSchema).max(LIMITS.questionsPerQuiz, `${LIMITS.questionsPerQuiz} questions maximum`),
      status: z.enum(['draft', 'published']).default('published'),
      visibility: z.enum(['private', 'code', 'public']).default('private'),
      subcategory: trimmed(LIMITS.subcategory).default(''),
      tags: z.array(z.string().max(100)).max(50).default([]).transform(cleanTags),
      difficulty: z.enum(['easy', 'medium', 'hard']).nullable().default(null),
      level: trimmed(LIMITS.category).default(''),
    })
    .superRefine((quiz, ctx) => {
      // Un brouillon peut être incomplet ; un quiz publié doit être entièrement valide.
      if (quiz.status === 'draft') return;
      quiz.questions.forEach((question, index) => {
        const problem = questionProblem(question);
        if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['questions', index] });
      });
    });
};

export const quizSchema = buildQuizSchema(false);
/** Mode sans serveur : les images sont conservées dans le quiz lui-même. */
export const embeddedQuizSchema = buildQuizSchema(true);

/** Lot de questions (banque de questions) : `{ questions }` pour que les erreurs indiquent le numéro de la question. */
const buildQuestionListSchema = (allowEmbedded: boolean) =>
  z.object({ questions: z.array(buildQuestionSchema(allowEmbedded)).min(1, 'Aucune question').max(100, '100 questions maximum à la fois') });

export const questionListSchema = buildQuestionListSchema(false);
export const embeddedQuestionListSchema = buildQuestionListSchema(true);

export const gameSettingsSchema = z.object({
  scoringMode: z.enum(['speed', 'fixed', 'none']),
  allowAnswerChange: z.boolean(),
  allowBack: z.boolean(),
  endWhenAllAnswered: z.boolean(),
  autoRevealAnswers: z.boolean(),
  autoAdvance: z.boolean(),
  maxPlayers: z.number().int().min(1).max(LIMITS.maxPlayers),
  presenceWatch: z.boolean(),
  pinApp: z.boolean(),
});

/** Signal de présence d'un élève (format court : il part toutes les 2 s). */
export const presenceReportSchema = z.discriminatedUnion('s', [
  z.object({ s: z.literal('beat'), v: z.boolean(), app: z.boolean().optional(), pinned: z.boolean().optional() }),
  z.object({ s: z.literal('away'), r: z.enum(REPORTABLE_REASONS as unknown as [AwayReason, ...AwayReason[]]), app: z.boolean().optional() }),
  z.object({ s: z.literal('back'), app: z.boolean().optional() }),
]);

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
  z.object({ kind: z.literal('number'), value: finiteNumber }),
  z.object({ kind: z.literal('order'), order: z.array(z.number().int().min(0).max(LIMITS.maxItems - 1)).max(LIMITS.maxItems) }),
  z.object({ kind: z.literal('match'), pairs: z.array(z.number().int().min(0).max(LIMITS.maxChoices - 1)).max(LIMITS.maxChoices) }),
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
