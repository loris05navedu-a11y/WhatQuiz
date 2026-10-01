import { DEFAULT_TIME_LIMIT, LIMITS, QUESTION_TYPE_LABELS, type QuestionType } from './constants';
import { normalizeText } from './text';
import type {
  AnswerInput,
  Correction,
  PublicQuestion,
  QuestionConfig,
  QuestionInput,
  QuestionStats,
  SubmittedAnswer,
  TextAnswerStat,
} from './types';

/**
 * Registre des types de questions : tout ce qui dépend du type (validation, présentation aux élèves,
 * correction, statistiques, réponses des élèves fictifs) est décrit ici, une seule fois, et utilisé par
 * l'éditeur, le serveur et le mode sans serveur. Ajouter un type = ajouter une définition ci-dessous,
 * puis son affichage dans client/src/questionTypes/.
 *
 * Deux formes de réponse coexistent :
 * - « affichée » : indices dans l'ordre présenté à l'élève (choix ou éléments éventuellement mélangés) ;
 * - « de référence » : indices dans l'ordre d'origine de la question. C'est elle qui est corrigée et enregistrée.
 */

export type GradableQuestion = Pick<QuestionInput, 'type' | 'answers'> & Partial<Pick<QuestionInput, 'config'>>;

/** Ordre de présentation tiré au début de la partie : position affichée → indice d'origine. */
export interface QuestionLayout {
  items?: number[];
  /** Association : options de droite. */
  options?: number[];
}

export interface Grade {
  correct: boolean;
  /** Part juste de la réponse (0 à 1) : crédit partiel pour l'ordre et les associations. */
  ratio: number;
}

export interface RecordedAnswerStat {
  /** Réponse de référence. */
  answer: SubmittedAnswer;
  correct: boolean;
}

export type Random = () => number;

export interface QuestionTypeDefinition {
  type: QuestionType;
  label: string;
  description: string;
  /** Faux : pas de bonne réponse (sondage, nuage de mots, classement d'avis), aucun point. */
  scored: boolean;
  /** Les choix peuvent être mélangés par le réglage « mélanger les réponses ». */
  shuffleable: boolean;
  defaultTimeLimit: number;
  createAnswers(): AnswerInput[];
  createConfig?(): QuestionConfig;
  /** Problème propre au type (les règles communes sont vérifiées par quizRules). */
  validate(question: QuestionInput): string | null;
  layout(question: GradableQuestion, random: Random, shuffle: boolean): QuestionLayout;
  publicPart(question: GradableQuestion, layout: QuestionLayout): Pick<PublicQuestion, 'choices'> & Partial<Pick<PublicQuestion, 'options' | 'range' | 'unit'>>;
  /** Correction exprimée dans l'ordre affiché. */
  correction(question: GradableQuestion, layout: QuestionLayout): Correction;
  /** Vérifie une réponse affichée et la convertit en réponse de référence (null si invalide). */
  accept(answer: SubmittedAnswer, question: GradableQuestion, layout: QuestionLayout): SubmittedAnswer | null;
  /** Réponse de référence → réponse affichée (pour la renvoyer à l'élève). */
  toDisplay(answer: SubmittedAnswer, layout: QuestionLayout): SubmittedAnswer;
  grade(question: GradableQuestion, answer: SubmittedAnswer): Grade;
  /** Statistiques dans l'ordre affiché. */
  stats(question: GradableQuestion, answers: RecordedAnswerStat[], layout: QuestionLayout): QuestionStats;
  /** Réponse affichée d'un élève fictif. */
  botAnswer(question: GradableQuestion, layout: QuestionLayout, right: boolean, random: Random): SubmittedAnswer;
}

/* ───────────── Outils ───────────── */

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);
const NONE: Grade = { correct: false, ratio: 0 };

export function shuffledIndexes(n: number, random: Random, avoidIdentity = false): number[] {
  const order = identity(n);
  for (let attempt = 0; attempt < 5; attempt++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (!avoidIdentity || n < 2 || order.some((value, i) => value !== i)) return order;
  }
  // Mélange resté identique (très improbable) : simple rotation.
  return identity(n).map((i) => (i + 1) % n);
}

const displayOrder = (layout: QuestionLayout, n: number) => layout.items ?? identity(n);
/** Position affichée de chaque élément d'origine. */
const displayIndexOf = (order: number[]) => {
  const inverse: number[] = [];
  order.forEach((original, display) => (inverse[original] = display));
  return inverse;
};

const isIndexList = (values: unknown, size: number): values is number[] =>
  Array.isArray(values) && values.every((v) => Number.isInteger(v) && v >= 0 && v < size);

const filledAnswers = (answers: AnswerInput[]) => answers.every((a) => a.text.trim().length > 0);

export function correctChoiceIndexes(question: Pick<QuestionInput, 'answers'>): number[] {
  return question.answers.flatMap((answer, index) => (answer.isCorrect ? [index] : []));
}

function pick<T>(items: T[], random: Random): T {
  return items[Math.floor(random() * items.length)];
}

function groupTexts(answers: RecordedAnswerStat[], limit: number): TextAnswerStat[] {
  const grouped = new Map<string, TextAnswerStat>();
  for (const { answer, correct } of answers) {
    if (answer.kind !== 'text') continue;
    const key = normalizeText(answer.text);
    if (!key) continue;
    const stat = grouped.get(key) ?? { text: answer.text.trim(), count: 0, correct };
    stat.count += 1;
    grouped.set(key, stat);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'fr')).slice(0, limit);
}

const emptyCorrection = (): Correction => ({ correctChoices: [], acceptedAnswers: [] });

/* ───────────── Questions à choix (QCM, Vrai/Faux, sondage) ───────────── */

function choiceType(options: {
  type: 'single' | 'multiple' | 'truefalse' | 'poll';
  description: string;
  scored: boolean;
  multiple: boolean;
  shuffleable: boolean;
  defaultTimeLimit: number;
  createAnswers(): AnswerInput[];
  validate(question: QuestionInput, correct: number): string | null;
}): QuestionTypeDefinition {
  return {
    type: options.type,
    label: QUESTION_TYPE_LABELS[options.type],
    description: options.description,
    scored: options.scored,
    shuffleable: options.shuffleable,
    defaultTimeLimit: options.defaultTimeLimit,
    createAnswers: options.createAnswers,
    validate(question) {
      if (!filledAnswers(question.answers)) return 'Une réponse est vide';
      return options.validate(question, question.answers.filter((a) => a.isCorrect).length);
    },
    layout: (question, random, shuffle) => (shuffle && options.shuffleable ? { items: shuffledIndexes(question.answers.length, random) } : {}),
    publicPart: (question, layout) => ({ choices: displayOrder(layout, question.answers.length).map((i) => question.answers[i].text) }),
    correction(question, layout) {
      if (!options.scored) return emptyCorrection();
      const position = displayIndexOf(displayOrder(layout, question.answers.length));
      return { correctChoices: correctChoiceIndexes(question).map((i) => position[i]).sort((a, b) => a - b), acceptedAnswers: [] };
    },
    accept(answer, question, layout) {
      if (answer.kind !== 'choice' || answer.choices.length === 0 || !isIndexList(answer.choices, question.answers.length)) return null;
      const unique = [...new Set(answer.choices)];
      if (!options.multiple && unique.length !== 1) return null;
      const order = displayOrder(layout, question.answers.length);
      return { kind: 'choice', choices: unique.map((d) => order[d]).sort((a, b) => a - b) };
    },
    toDisplay(answer, layout) {
      if (answer.kind !== 'choice' || !layout.items) return answer;
      const position = displayIndexOf(layout.items);
      return { kind: 'choice', choices: answer.choices.map((i) => position[i]).sort((a, b) => a - b) };
    },
    grade(question, answer) {
      if (!options.scored || answer.kind !== 'choice') return NONE;
      const expected = correctChoiceIndexes(question);
      const given = [...new Set(answer.choices)].sort((a, b) => a - b);
      const correct = given.length === expected.length && given.every((choice, i) => choice === expected[i]);
      return { correct, ratio: correct ? 1 : 0 };
    },
    stats(question, answers, layout) {
      const order = displayOrder(layout, question.answers.length);
      const position = displayIndexOf(order);
      const counts = order.map(() => 0);
      for (const { answer } of answers) if (answer.kind === 'choice') for (const c of answer.choices) counts[position[c]] += 1;
      return { kind: 'choices', counts };
    },
    botAnswer(question, layout, right, random) {
      const order = displayOrder(layout, question.answers.length);
      const position = displayIndexOf(order);
      if (!options.scored) return { kind: 'choice', choices: [Math.floor(random() * question.answers.length)] };
      const correct = correctChoiceIndexes(question).map((i) => position[i]);
      if (right) return { kind: 'choice', choices: correct };
      const wrong = order.map((_, d) => d).filter((d) => !correct.includes(d));
      return { kind: 'choice', choices: [wrong.length ? pick(wrong, random) : 0] };
    },
  };
}

const emptyChoices = (count: number): AnswerInput[] => Array.from({ length: count }, () => ({ text: '', isCorrect: false }));

const choiceCount = (question: QuestionInput, max: number = LIMITS.maxChoices) => {
  if (question.answers.length < LIMITS.minChoices) return 'Au moins 2 réponses sont nécessaires';
  if (question.answers.length > max) return `${max} réponses maximum`;
  return null;
};

const single = choiceType({
  type: 'single',
  description: 'Une seule bonne réponse parmi 2 à 6 choix.',
  scored: true,
  multiple: false,
  shuffleable: true,
  defaultTimeLimit: DEFAULT_TIME_LIMIT,
  createAnswers: () => emptyChoices(4),
  validate: (q, correct) => choiceCount(q) ?? (correct !== 1 ? 'Choisissez exactement une bonne réponse' : null),
});

const multiple = choiceType({
  type: 'multiple',
  description: 'Plusieurs bonnes réponses : il faut toutes les trouver.',
  scored: true,
  multiple: true,
  shuffleable: true,
  defaultTimeLimit: DEFAULT_TIME_LIMIT,
  createAnswers: () => emptyChoices(4),
  validate: (q, correct) => choiceCount(q) ?? (correct < 1 ? 'Choisissez au moins une bonne réponse' : null),
});

const truefalse = choiceType({
  type: 'truefalse',
  description: 'Une affirmation, vraie ou fausse.',
  scored: true,
  multiple: false,
  shuffleable: false,
  defaultTimeLimit: 10,
  createAnswers: () => [
    { text: 'Vrai', isCorrect: true },
    { text: 'Faux', isCorrect: false },
  ],
  validate: (q, correct) =>
    q.answers.length !== 2 ? 'Une question Vrai/Faux possède 2 réponses' : correct !== 1 ? 'Indiquez si la bonne réponse est Vrai ou Faux' : null,
});

const poll = choiceType({
  type: 'poll',
  description: 'Recueillir l’avis de la classe : pas de bonne réponse, pas de points.',
  scored: false,
  multiple: false,
  shuffleable: true,
  defaultTimeLimit: 20,
  createAnswers: () => emptyChoices(3),
  validate: (q) => choiceCount(q),
});

/* ───────────── Réponses libres (texte, nuage de mots) ───────────── */

const text: QuestionTypeDefinition = {
  type: 'text',
  label: QUESTION_TYPE_LABELS.text,
  description: 'L’élève tape sa réponse ; casse, accents et espaces sont ignorés.',
  scored: true,
  shuffleable: false,
  defaultTimeLimit: 30,
  createAnswers: () => [{ text: '', isCorrect: true }],
  validate(question) {
    if (question.answers.length < 1) return 'Ajoutez au moins une réponse acceptée';
    if (question.answers.length > LIMITS.maxAcceptedAnswers) return '10 réponses acceptées maximum';
    return filledAnswers(question.answers) ? null : 'Une réponse est vide';
  },
  layout: () => ({}),
  publicPart: () => ({ choices: [] }),
  correction: (question) => ({ correctChoices: [], acceptedAnswers: question.answers.map((a) => a.text) }),
  accept(answer) {
    if (answer.kind !== 'text') return null;
    const value = answer.text.trim();
    return value && value.length <= LIMITS.answerText ? { kind: 'text', text: value } : null;
  },
  toDisplay: (answer) => answer,
  grade(question, answer) {
    if (answer.kind !== 'text') return NONE;
    const given = normalizeText(answer.text);
    const correct = given.length > 0 && question.answers.some((accepted) => normalizeText(accepted.text) === given);
    return { correct, ratio: correct ? 1 : 0 };
  },
  stats: (_question, answers) => ({ kind: 'texts', items: groupTexts(answers, 12) }),
  botAnswer: (question, _layout, right) => ({ kind: 'text', text: right ? (question.answers[0]?.text ?? '?') : 'Je ne sais pas' }),
};

const BOT_WORDS = ['génial', 'difficile', 'intéressant', 'rapide', 'fun', 'curieux', 'facile', 'surprenant'];

const wordcloud: QuestionTypeDefinition = {
  type: 'wordcloud',
  label: QUESTION_TYPE_LABELS.wordcloud,
  description: 'Chaque élève propose un mot ; les plus fréquents apparaissent en grand.',
  scored: false,
  shuffleable: false,
  defaultTimeLimit: 30,
  createAnswers: () => [],
  validate: (question) => (question.answers.length > 0 ? 'Un nuage de mots n’a pas de réponse attendue' : null),
  layout: () => ({}),
  publicPart: () => ({ choices: [] }),
  correction: emptyCorrection,
  accept(answer) {
    if (answer.kind !== 'text') return null;
    const value = answer.text.trim().replace(/\s+/g, ' ');
    return value && value.length <= LIMITS.wordcloudAnswer ? { kind: 'text', text: value } : null;
  },
  toDisplay: (answer) => answer,
  grade: () => NONE,
  stats: (_question, answers) => ({ kind: 'texts', items: groupTexts(answers, 40) }),
  botAnswer: (_q, _l, _r, random) => ({ kind: 'text', text: pick(BOT_WORDS, random) }),
};

/* ───────────── Valeurs numériques (réponse numérique, curseur) ───────────── */

const MAX_ABS_VALUE = 1e12;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_ABS_VALUE;

function withinTolerance(config: QuestionConfig | undefined, value: number): boolean {
  if (!config || !finite(config.answer)) return false;
  return Math.abs(value - config.answer) <= (config.tolerance ?? 0) + 1e-9;
}

function numberStats(question: GradableQuestion, answers: RecordedAnswerStat[]): QuestionStats {
  const grouped = new Map<number, { value: number; count: number; correct: boolean }>();
  let sum = 0;
  let n = 0;
  for (const { answer } of answers) {
    if (answer.kind !== 'number') continue;
    sum += answer.value;
    n += 1;
    const entry = grouped.get(answer.value) ?? { value: answer.value, count: 0, correct: withinTolerance(question.config, answer.value) };
    entry.count += 1;
    grouped.set(answer.value, entry);
  }
  const items = [...grouped.values()].sort((a, b) => b.count - a.count || a.value - b.value).slice(0, 12);
  return { kind: 'numbers', items, average: n ? sum / n : null };
}

const numberCorrection = (question: GradableQuestion): Correction => ({
  ...emptyCorrection(),
  correctValue: { answer: question.config?.answer ?? 0, tolerance: question.config?.tolerance ?? 0 },
});

const numberGrade = (question: GradableQuestion, answer: SubmittedAnswer): Grade => {
  const correct = answer.kind === 'number' && withinTolerance(question.config, answer.value);
  return { correct, ratio: correct ? 1 : 0 };
};

function validateNumberConfig(config: QuestionConfig | undefined): string | null {
  if (!config || !finite(config.answer)) return 'Indiquez la réponse attendue';
  if (config.tolerance !== undefined && (!finite(config.tolerance) || config.tolerance < 0)) return 'La marge d’erreur doit être positive';
  if (config.unit !== undefined && config.unit.length > LIMITS.unit) return `Unité : ${LIMITS.unit} caractères maximum`;
  return null;
}

const numeric: QuestionTypeDefinition = {
  type: 'numeric',
  label: QUESTION_TYPE_LABELS.numeric,
  description: 'L’élève saisit un nombre ; une marge d’erreur peut être acceptée.',
  scored: true,
  shuffleable: false,
  defaultTimeLimit: 30,
  createAnswers: () => [],
  createConfig: () => ({ answer: undefined, tolerance: 0, unit: '' }),
  validate: (question) => (question.answers.length > 0 ? 'Réponse numérique : utilisez le champ « réponse attendue »' : validateNumberConfig(question.config)),
  layout: () => ({}),
  publicPart: (question) => ({ choices: [], unit: question.config?.unit || undefined }),
  correction: numberCorrection,
  accept: (answer) => (answer.kind === 'number' && finite(answer.value) ? { kind: 'number', value: answer.value } : null),
  toDisplay: (answer) => answer,
  grade: numberGrade,
  stats: numberStats,
  botAnswer(question, _layout, right, random) {
    const answer = question.config?.answer ?? 0;
    if (right) return { kind: 'number', value: answer };
    const offset = (question.config?.tolerance ?? 0) + Math.max(1, Math.abs(answer) * 0.2) * (0.5 + random());
    return { kind: 'number', value: Math.round((answer + (random() < 0.5 ? -offset : offset)) * 100) / 100 };
  },
};

const MAX_SLIDER_STEPS = 10_000;

const slider: QuestionTypeDefinition = {
  type: 'slider',
  label: QUESTION_TYPE_LABELS.slider,
  description: 'L’élève place un curseur entre deux bornes.',
  scored: true,
  shuffleable: false,
  defaultTimeLimit: 20,
  createAnswers: () => [],
  createConfig: () => ({ min: 0, max: 100, step: 1, answer: 50, tolerance: 0, unit: '' }),
  validate(question) {
    const c = question.config;
    if (question.answers.length > 0) return 'Curseur : utilisez les champs de réglage';
    if (!c || !finite(c.min) || !finite(c.max) || !finite(c.step)) return 'Indiquez le minimum, le maximum et le pas';
    if (c.min >= c.max) return 'Le minimum doit être inférieur au maximum';
    if (c.step <= 0) return 'Le pas doit être positif';
    if ((c.max - c.min) / c.step > MAX_SLIDER_STEPS) return 'Trop de positions : augmentez le pas';
    const problem = validateNumberConfig(c);
    if (problem) return problem;
    if (c.answer! < c.min || c.answer! > c.max) return 'La réponse doit être entre le minimum et le maximum';
    return null;
  },
  layout: () => ({}),
  publicPart: (question) => {
    const { min = 0, max = 100, step = 1, unit } = question.config ?? {};
    return { choices: [], range: { min, max, step }, unit: unit || undefined };
  },
  correction: numberCorrection,
  accept(answer, question) {
    const { min = 0, max = 100 } = question.config ?? {};
    return answer.kind === 'number' && finite(answer.value) && answer.value >= min && answer.value <= max ? { kind: 'number', value: answer.value } : null;
  },
  toDisplay: (answer) => answer,
  grade: numberGrade,
  stats: numberStats,
  botAnswer(question, _layout, right, random) {
    const { min = 0, max = 100, step = 1, answer = 50 } = question.config ?? {};
    if (right) return { kind: 'number', value: answer };
    const steps = Math.round((max - min) / step);
    return { kind: 'number', value: Math.round((min + Math.floor(random() * (steps + 1)) * step) * 1e6) / 1e6 };
  },
};

/* ───────────── Ordre (remettre dans l'ordre, classement d'avis) ───────────── */

function orderType(options: { type: 'order' | 'ranking'; scored: boolean; description: string }): QuestionTypeDefinition {
  return {
    type: options.type,
    label: QUESTION_TYPE_LABELS[options.type],
    description: options.description,
    scored: options.scored,
    shuffleable: false,
    defaultTimeLimit: 45,
    createAnswers: () => Array.from({ length: 4 }, () => ({ text: '', isCorrect: true })),
    validate(question) {
      if (question.answers.length < LIMITS.minItems) return 'Au moins 2 éléments sont nécessaires';
      if (question.answers.length > LIMITS.maxItems) return `${LIMITS.maxItems} éléments maximum`;
      return filledAnswers(question.answers) ? null : 'Un élément est vide';
    },
    // Toujours mélangé : sinon la réponse serait donnée d'avance.
    layout: (question, random) => ({ items: shuffledIndexes(question.answers.length, random, options.scored) }),
    publicPart: (question, layout) => ({ choices: displayOrder(layout, question.answers.length).map((i) => question.answers[i].text) }),
    correction(question, layout) {
      if (!options.scored) return emptyCorrection();
      const position = displayIndexOf(displayOrder(layout, question.answers.length));
      return { ...emptyCorrection(), correctOrder: question.answers.map((_, original) => position[original]) };
    },
    accept(answer, question, layout) {
      const n = question.answers.length;
      if (answer.kind !== 'order' || answer.order.length !== n || !isIndexList(answer.order, n) || new Set(answer.order).size !== n) return null;
      const order = displayOrder(layout, n);
      return { kind: 'order', order: answer.order.map((d) => order[d]) };
    },
    toDisplay(answer, layout) {
      if (answer.kind !== 'order' || !layout.items) return answer;
      const position = displayIndexOf(layout.items);
      return { kind: 'order', order: answer.order.map((i) => position[i]) };
    },
    grade(question, answer) {
      if (!options.scored || answer.kind !== 'order') return NONE;
      const right = answer.order.filter((original, place) => original === place).length;
      return { correct: right === question.answers.length, ratio: right / question.answers.length };
    },
    stats(question, answers, layout) {
      const n = question.answers.length;
      const order = displayOrder(layout, n);
      const sums = new Array<number>(n).fill(0);
      const right = new Array<number>(n).fill(0);
      let count = 0;
      for (const { answer } of answers) {
        if (answer.kind !== 'order') continue;
        count += 1;
        answer.order.forEach((original, place) => {
          sums[original] += place + 1;
          if (original === place) right[original] += 1;
        });
      }
      return {
        kind: 'order',
        averagePositions: order.map((original) => (count ? sums[original] / count : null)),
        correctRates: order.map((original) => (count && options.scored ? right[original] / count : 0)),
      };
    },
    botAnswer(question, layout, right, random) {
      const n = question.answers.length;
      const position = displayIndexOf(displayOrder(layout, n));
      if (right && options.scored) return { kind: 'order', order: identity(n).map((original) => position[original]) };
      return { kind: 'order', order: shuffledIndexes(n, random) };
    },
  };
}

const order = orderType({ type: 'order', scored: true, description: 'Remettre des éléments dans le bon ordre (crédit partiel).' });
const ranking = orderType({ type: 'ranking', scored: false, description: 'Chaque élève classe les éléments selon son avis.' });

/* ───────────── Association ───────────── */

const match: QuestionTypeDefinition = {
  type: 'match',
  label: QUESTION_TYPE_LABELS.match,
  description: 'Relier chaque élément à son correspondant (crédit partiel).',
  scored: true,
  shuffleable: false,
  defaultTimeLimit: 60,
  createAnswers: () => Array.from({ length: 3 }, () => ({ text: '', isCorrect: true, match: '' })),
  validate(question) {
    const { answers } = question;
    if (answers.length < LIMITS.minItems) return 'Au moins 2 paires sont nécessaires';
    if (answers.length > LIMITS.maxChoices) return `${LIMITS.maxChoices} paires maximum`;
    if (answers.some((a) => !a.text.trim() || !a.match?.trim())) return 'Une paire est incomplète';
    if (answers.some((a) => a.match!.length > LIMITS.answerText)) return 'Un élément est trop long';
    if (new Set(answers.map((a) => normalizeText(a.match!))).size !== answers.length) return 'Deux éléments de droite sont identiques';
    return null;
  },
  layout: (question, random) => ({ options: shuffledIndexes(question.answers.length, random, true) }),
  publicPart(question, layout) {
    const options = layout.options ?? identity(question.answers.length);
    return { choices: question.answers.map((a) => a.text), options: options.map((i) => question.answers[i].match ?? '') };
  },
  correction(question, layout) {
    const position = displayIndexOf(layout.options ?? identity(question.answers.length));
    return { ...emptyCorrection(), correctPairs: question.answers.map((_, i) => position[i]) };
  },
  accept(answer, question, layout) {
    const n = question.answers.length;
    if (answer.kind !== 'match' || answer.pairs.length !== n || !isIndexList(answer.pairs, n)) return null;
    const options = layout.options ?? identity(n);
    return { kind: 'match', pairs: answer.pairs.map((d) => options[d]) };
  },
  toDisplay(answer, layout) {
    if (answer.kind !== 'match' || !layout.options) return answer;
    const position = displayIndexOf(layout.options);
    return { kind: 'match', pairs: answer.pairs.map((i) => position[i]) };
  },
  grade(question, answer) {
    if (answer.kind !== 'match') return NONE;
    const right = answer.pairs.filter((original, i) => original === i).length;
    return { correct: right === question.answers.length, ratio: right / question.answers.length };
  },
  stats(question, answers) {
    const n = question.answers.length;
    const right = new Array<number>(n).fill(0);
    let count = 0;
    for (const { answer } of answers) {
      if (answer.kind !== 'match') continue;
      count += 1;
      answer.pairs.forEach((original, i) => original === i && (right[i] += 1));
    }
    return { kind: 'match', correctRates: right.map((r) => (count ? r / count : 0)) };
  },
  botAnswer(question, layout, right, random) {
    const n = question.answers.length;
    const position = displayIndexOf(layout.options ?? identity(n));
    if (right) return { kind: 'match', pairs: identity(n).map((i) => position[i]) };
    return { kind: 'match', pairs: shuffledIndexes(n, random) };
  },
};

/* ───────────── Registre ───────────── */

export const QUESTION_TYPE_DEFINITIONS: Record<QuestionType, QuestionTypeDefinition> = {
  single,
  multiple,
  truefalse,
  text,
  numeric,
  slider,
  order,
  match,
  ranking,
  poll,
  wordcloud,
};

export function questionType(type: QuestionType): QuestionTypeDefinition {
  return QUESTION_TYPE_DEFINITIONS[type];
}

export const isScored = (question: Pick<QuestionInput, 'type'>) => QUESTION_TYPE_DEFINITIONS[question.type].scored;

/** Correction sans mélange (ordre d'origine) : aperçu de l'éditeur, résultats, élèves fictifs. */
export function gradeAnswer(question: GradableQuestion, answer: SubmittedAnswer): Grade {
  const definition = QUESTION_TYPE_DEFINITIONS[question.type];
  const accepted = definition.accept(answer, question, {});
  return accepted ? definition.grade(question, accepted) : NONE;
}

/** Types dont toutes les réponses sont « correctes » par construction (réponses acceptées, éléments, paires). */
const ALL_CORRECT: ReadonlySet<QuestionType> = new Set(['text', 'order', 'ranking', 'match']);
/** Types sans bonne réponse. */
const NONE_CORRECT: ReadonlySet<QuestionType> = new Set(['poll']);
/** Types qui utilisent les réglages numériques. */
const USES_CONFIG: ReadonlySet<QuestionType> = new Set(['numeric', 'slider']);

/** Met une question dans sa forme canonique pour son type (champs inutiles retirés). */
export function normalizeQuestion<T extends QuestionInput>(question: T): T {
  const { type } = question;
  const answers = question.answers.map((a) => ({
    text: a.text,
    isCorrect: ALL_CORRECT.has(type) ? true : NONE_CORRECT.has(type) ? false : a.isCorrect,
    ...(type === 'match' ? { match: a.match ?? '' } : {}),
  }));
  const { config: _config, ...rest } = question;
  return { ...rest, answers, ...(USES_CONFIG.has(type) && question.config ? { config: question.config } : {}) } as T;
}
