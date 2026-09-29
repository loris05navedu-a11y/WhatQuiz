export const QUESTION_TYPES = ['single', 'multiple', 'truefalse', 'text'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: 'QCM — une réponse',
  multiple: 'QCM — plusieurs réponses',
  truefalse: 'Vrai / Faux',
  text: 'Réponse texte',
};

export const TIME_LIMITS = [5, 10, 15, 20, 30, 45, 60, 120] as const;
export const POINTS_OPTIONS = [500, 1000, 2000] as const;
export const DEFAULT_TIME_LIMIT = 20;
export const DEFAULT_POINTS = 1000;

export const LIMITS = {
  quizTitle: 120,
  quizDescription: 500,
  category: 40,
  questionsPerQuiz: 100,
  questionText: 300,
  answerText: 120,
  minChoices: 2,
  maxChoices: 6,
  maxAcceptedAnswers: 10,
  nickname: 20,
  displayName: 60,
  minPassword: 8,
  maxPlayers: 200,
  maxBots: 30,
} as const;

export const CATEGORIES = [
  'Culture générale',
  'Mathématiques',
  'Français',
  'Histoire-Géographie',
  'Sciences',
  'Anglais',
  'Langues',
  'Arts',
  'Musique',
  'Sport',
  'Informatique',
  'Autre',
] as const;

export const GAME_CODE_LENGTH = 6;

/** Réactions que les élèves peuvent envoyer à l'écran du professeur. */
export const REACTIONS = ['👍', '👏', '😂', '😮', '🤔', '🔥'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Messages d'erreur visibles par les utilisateurs (jamais de détails techniques). */
export const ERRORS = {
  generic: 'Une erreur est survenue',
  gameNotFound: 'Code de partie incorrect',
  gameEnded: 'La partie est terminée',
  gameFull: 'La partie est complète',
  gameLocked: 'Les inscriptions sont verrouillées',
  nicknameTaken: 'Ce pseudo est déjà utilisé',
  nicknameInvalid: 'Pseudo invalide (1 à 20 caractères)',
  connectionLost: 'Connexion perdue',
  timeUp: 'Le temps est écoulé',
  alreadyAnswered: 'Réponse déjà enregistrée',
  notAccepting: 'Les réponses ne sont pas ouvertes',
  kicked: 'Vous avez été exclu de la partie',
  forbidden: 'Action non autorisée',
  unauthenticated: 'Veuillez vous connecter',
  invalidInput: 'Données invalides',
  notFound: 'Élément introuvable',
} as const;

export const DEFAULT_GAME_SETTINGS = {
  scoringMode: 'speed',
  allowAnswerChange: false,
  allowBack: true,
  endWhenAllAnswered: true,
  autoRevealAnswers: true,
  autoAdvance: false,
  maxPlayers: 100,
} as const;
