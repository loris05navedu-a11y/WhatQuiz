/** Types de questions. Comportement de chaque type : shared/questionTypes.ts ; affichage : client/src/questionTypes/. */
export const QUESTION_TYPES = [
  'single',
  'multiple',
  'truefalse',
  'text',
  'numeric',
  'slider',
  'order',
  'match',
  'ranking',
  'poll',
  'wordcloud',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: 'QCM — une réponse',
  multiple: 'QCM — plusieurs réponses',
  truefalse: 'Vrai / Faux',
  text: 'Réponse texte',
  numeric: 'Réponse numérique',
  slider: 'Curseur',
  order: 'Remettre dans l’ordre',
  match: 'Association',
  ranking: 'Classement (avis)',
  poll: 'Sondage',
  wordcloud: 'Nuage de mots',
};

export const TIME_LIMITS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240] as const;
export const POINTS_OPTIONS = [500, 1000, 2000] as const;
export const DEFAULT_TIME_LIMIT = 20;
export const DEFAULT_POINTS = 1000;

export const LIMITS = {
  tag: 30,
  tagsPerQuiz: 10,
  subcategory: 40,
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
  minItems: 2,
  maxItems: 8,
  explanation: 500,
  wordcloudAnswer: 30,
  unit: 15,
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

/** Codes de partage lisibles : sans 0/O, 1/I/L. */
export const SHARE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHARE_CODE_LENGTH = 6;

export const DIFFICULTY_LABELS = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' } as const;

export const SCHOOL_LEVELS = [
  'Maternelle',
  'CP',
  'CE1',
  'CE2',
  'CM1',
  'CM2',
  '6e',
  '5e',
  '4e',
  '3e',
  '2nde',
  '1re',
  'Terminale',
  'Supérieur',
  'Adultes',
] as const;

/** Sous-catégories proposées (saisie libre possible). */
export const SUBCATEGORIES: Partial<Record<(typeof CATEGORIES)[number], string[]>> = {
  Mathématiques: ['Algèbre', 'Équations', 'Géométrie', 'Arithmétique', 'Fractions', 'Fonctions', 'Probabilités', 'Statistiques', 'Calcul mental'],
  Français: ['Grammaire', 'Conjugaison', 'Orthographe', 'Vocabulaire', 'Littérature'],
  'Histoire-Géographie': ['Antiquité', 'Moyen Âge', 'Époque moderne', 'XXe siècle', 'Géographie', 'Éducation civique'],
  Sciences: ['Physique', 'Chimie', 'Biologie', 'Géologie', 'Astronomie', 'Technologie'],
  Anglais: ['Vocabulaire', 'Grammaire', 'Compréhension', 'Civilisation'],
  Informatique: ['Algorithmique', 'Programmation', 'Réseaux', 'Numérique responsable'],
};

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
