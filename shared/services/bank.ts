import { CATEGORIES, LIMITS } from '../constants';
import type { DocStore, StoredDoc } from '../documents';
import { ServiceError } from '../documents';
import { cleanTags, toQuizInput } from '../quizMeta';
import { questionProblem } from '../quizRules';
import { randomUuid } from '../random';
import type { BankFolder, BankQuestion, Difficulty, QuestionInput } from '../types';
import { nowIso, requireTeacher } from './access';
import type { ServiceContext, SharedRoute } from './context';
import { recordQuizVersion } from './versions';

/**
 * Banque de questions d'un professeur : questions réutilisables rangées dans des dossiers (imbriqués), avec tags et
 * difficulté. On peut y ajouter les questions d'un quiz, en insérer dans un quiz ou créer un quiz à partir d'une sélection.
 */
export const BANK_QUESTION = 'bankQuestion';
export const BANK_FOLDER = 'bankFolder';

interface BankQuestionDoc extends StoredDoc {
  question: QuestionInput;
  folderId: string | null;
  tags: string[];
  difficulty: Difficulty | null;
  source: string;
  usage: number;
}

interface BankFolderDoc extends StoredDoc {
  name: string;
  parentId: string | null;
}

const toQuestion = ({ id, question, folderId, tags, difficulty, source, usage, createdAt, updatedAt }: BankQuestionDoc): BankQuestion => ({
  id,
  question,
  folderId,
  tags,
  difficulty,
  source,
  usage,
  createdAt,
  updatedAt,
});

const toFolder = ({ id, name, parentId, createdAt }: BankFolderDoc): BankFolder => ({ id, name, parentId, createdAt });

/* ───── Lecture et contrôles ───── */

const body = (ctx: ServiceContext): Record<string, unknown> =>
  ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};

const questionsOf = (docs: DocStore, ownerId: number) => docs.list<BankQuestionDoc>(BANK_QUESTION, ownerId);
const foldersOf = (docs: DocStore, ownerId: number) => docs.list<BankFolderDoc>(BANK_FOLDER, ownerId);

function ownedQuestion(ctx: ServiceContext, ownerId: number, id: string): BankQuestionDoc {
  const doc = ctx.docs.get<BankQuestionDoc>(BANK_QUESTION, id);
  if (!doc || doc.ownerId !== ownerId) throw new ServiceError(404, 'Question introuvable dans la banque');
  return doc;
}

function ownedFolder(ctx: ServiceContext, ownerId: number, id: string): BankFolderDoc {
  const doc = ctx.docs.get<BankFolderDoc>(BANK_FOLDER, id);
  if (!doc || doc.ownerId !== ownerId) throw new ServiceError(404, 'Dossier introuvable');
  return doc;
}

/** Dossier de destination : null (racine) ou un dossier existant du professeur. */
function folderField(ctx: ServiceContext, ownerId: number, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ServiceError(400, 'Dossier invalide');
  return ownedFolder(ctx, ownerId, value).id;
}

function tagsField(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) throw new ServiceError(400, 'Tags invalides');
  return cleanTags(value as string[]);
}

function difficultyField(value: unknown): Difficulty | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'easy' || value === 'medium' || value === 'hard') return value;
  throw new ServiceError(400, 'Difficulté invalide');
}

function idsField(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.bankQuestions || value.some((id) => typeof id !== 'string')) {
    throw new ServiceError(400, 'Sélection invalide');
  }
  return [...new Set(value as string[])];
}

/** Les questions de la banque doivent être complètes : elles servent telles quelles dans d'autres quiz. */
function validQuestions(ctx: ServiceContext, raw: unknown): QuestionInput[] {
  const questions = ctx.parseQuestions(raw);
  questions.forEach((question, index) => {
    const problem = questionProblem(question);
    if (problem) throw new ServiceError(400, questions.length > 1 ? `Question ${index + 1} : ${problem}` : problem);
  });
  return questions;
}

function folderName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new ServiceError(400, 'Donnez un nom au dossier');
  if (name.length > LIMITS.folderName) throw new ServiceError(400, `${LIMITS.folderName} caractères maximum pour un nom de dossier`);
  return name;
}

function depthOf(folders: Map<string, BankFolderDoc>, id: string | null): number {
  let depth = 0;
  for (let current = id; current; current = folders.get(current)?.parentId ?? null) depth += 1;
  return depth;
}

/** Profondeur du sous-arbre (1 pour un dossier sans sous-dossier). */
function subtreeDepth(all: BankFolderDoc[], id: string): number {
  const children = all.filter((f) => f.parentId === id);
  return 1 + Math.max(0, ...children.map((child) => subtreeDepth(all, child.id)));
}

function descendants(all: BankFolderDoc[], id: string): Set<string> {
  const result = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of all) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }
  return result;
}

/* ───── Opérations ───── */

/** Ajoute des questions à la banque (utilisé aussi pour ranger toutes les questions d'un quiz). */
export function addBankQuestions(
  ctx: ServiceContext,
  ownerId: number,
  questions: QuestionInput[],
  options: { folderId: string | null; tags: string[]; difficulty: Difficulty | null; source: string },
): BankQuestion[] {
  const count = questionsOf(ctx.docs, ownerId).length;
  if (count + questions.length > LIMITS.bankQuestions) {
    throw new ServiceError(400, `La banque est limitée à ${LIMITS.bankQuestions} questions (${count} actuellement)`);
  }
  const base = ctx.now().getTime();
  return questions.map((question, index) => {
    // Horodatages croissants : les questions gardent leur ordre d'origine.
    const at = new Date(base + index).toISOString();
    const doc: BankQuestionDoc = { id: randomUuid(), ownerId, question, ...options, usage: 0, createdAt: at, updatedAt: at };
    ctx.docs.put(BANK_QUESTION, doc);
    return toQuestion(doc);
  });
}

export const bankRoutes: SharedRoute[] = [
  {
    method: 'GET',
    pattern: /^\/bank$/,
    handler(ctx) {
      const user = requireTeacher(ctx);
      return {
        questions: questionsOf(ctx.docs, user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(toQuestion),
        folders: foldersOf(ctx.docs, user.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
          .map(toFolder),
      };
    },
  },
  {
    method: 'POST',
    pattern: /^\/bank\/questions$/,
    status: 201,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const input = body(ctx);
      const questions = validQuestions(ctx, input.questions);
      const source = typeof input.source === 'string' ? input.source.trim().slice(0, LIMITS.quizTitle) : '';
      return {
        questions: addBankQuestions(ctx, user.id, questions, {
          folderId: folderField(ctx, user.id, input.folderId),
          tags: tagsField(input.tags),
          difficulty: difficultyField(input.difficulty),
          source,
        }),
      };
    },
  },
  {
    method: 'POST',
    pattern: /^\/bank\/from-quiz\/(\d+)$/,
    status: 201,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const quiz = ctx.quizzes.getOwned(user.id, Number(ctx.params[0]));
      if (!quiz) throw new ServiceError(404, 'Quiz introuvable');
      const complete = quiz.questions.map(({ id: _id, position: _position, ...question }) => question).filter((question) => !questionProblem(question));
      if (complete.length === 0) throw new ServiceError(400, 'Ce quiz ne contient aucune question complète');
      const input = body(ctx);
      const added = addBankQuestions(ctx, user.id, complete, {
        folderId: folderField(ctx, user.id, input.folderId),
        tags: cleanTags([...quiz.tags, ...tagsField(input.tags)]),
        difficulty: quiz.difficulty,
        source: quiz.title,
      });
      return { questions: added, skipped: quiz.questions.length - complete.length };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/bank\/questions\/([\w-]+)$/,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const doc = ownedQuestion(ctx, user.id, ctx.params[0]);
      const input = body(ctx);
      const next: BankQuestionDoc = { ...doc, updatedAt: nowIso(ctx) };
      if ('question' in input) next.question = validQuestions(ctx, [input.question])[0];
      if ('folderId' in input) next.folderId = folderField(ctx, user.id, input.folderId);
      if ('tags' in input) next.tags = tagsField(input.tags);
      if ('difficulty' in input) next.difficulty = difficultyField(input.difficulty);
      ctx.docs.put(BANK_QUESTION, next);
      return { question: toQuestion(next) };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/bank\/questions\/([\w-]+)$/,
    handler(ctx) {
      const user = requireTeacher(ctx);
      ctx.docs.delete(BANK_QUESTION, ownedQuestion(ctx, user.id, ctx.params[0]).id);
      return { ok: true };
    },
  },
  {
    /** Actions groupées sur une sélection : déplacer, ajouter des tags, supprimer. */
    method: 'POST',
    pattern: /^\/bank\/bulk$/,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const input = body(ctx);
      const docs = idsField(input.ids).map((id) => ownedQuestion(ctx, user.id, id));
      const at = nowIso(ctx);
      switch (input.action) {
        case 'move': {
          const folderId = folderField(ctx, user.id, input.folderId);
          for (const doc of docs) ctx.docs.put(BANK_QUESTION, { ...doc, folderId, updatedAt: at });
          break;
        }
        case 'tag': {
          const tags = tagsField(input.tags);
          for (const doc of docs) ctx.docs.put(BANK_QUESTION, { ...doc, tags: cleanTags([...doc.tags, ...tags]), updatedAt: at });
          break;
        }
        case 'delete':
          for (const doc of docs) ctx.docs.delete(BANK_QUESTION, doc.id);
          break;
        default:
          throw new ServiceError(400, 'Action inconnue');
      }
      return { ok: true, count: docs.length };
    },
  },
  {
    /** Questions choisies pour être insérées dans un quiz : renvoie leur contenu et compte l'utilisation. */
    method: 'POST',
    pattern: /^\/bank\/use$/,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const docs = idsField(body(ctx).ids).map((id) => ownedQuestion(ctx, user.id, id));
      if (docs.length > LIMITS.questionsPerQuiz) throw new ServiceError(400, `${LIMITS.questionsPerQuiz} questions maximum par quiz`);
      for (const doc of docs) ctx.docs.put(BANK_QUESTION, { ...doc, usage: doc.usage + 1 });
      return { questions: docs.map((doc) => doc.question) };
    },
  },
  {
    /** Crée un quiz (brouillon privé) à partir d'une sélection, dans l'ordre choisi. */
    method: 'POST',
    pattern: /^\/bank\/quiz$/,
    status: 201,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const input = body(ctx);
      const docs = idsField(input.ids).map((id) => ownedQuestion(ctx, user.id, id));
      if (docs.length > LIMITS.questionsPerQuiz) throw new ServiceError(400, `${LIMITS.questionsPerQuiz} questions maximum par quiz`);
      const title = (typeof input.title === 'string' ? input.title.trim() : '').slice(0, LIMITS.quizTitle) || 'Quiz depuis la banque';
      const category = typeof input.category === 'string' && input.category.trim() ? input.category.trim().slice(0, LIMITS.category) : CATEGORIES[0];
      const quiz = ctx.quizzes.create(user.id, {
        title,
        description: '',
        imageUrl: null,
        category,
        status: 'draft',
        visibility: 'private',
        tags: cleanTags(docs.flatMap((doc) => doc.tags)).slice(0, LIMITS.tagsPerQuiz),
        questions: docs.map((doc) => structuredClone(doc.question)),
      });
      for (const doc of docs) ctx.docs.put(BANK_QUESTION, { ...doc, usage: doc.usage + 1 });
      recordQuizVersion(ctx.docs, user.id, quiz.id, toQuizInput(quiz), 'save', ctx.now());
      return { quiz };
    },
  },
  {
    method: 'POST',
    pattern: /^\/bank\/folders$/,
    status: 201,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const input = body(ctx);
      const all = foldersOf(ctx.docs, user.id);
      if (all.length >= LIMITS.bankFolders) throw new ServiceError(400, `${LIMITS.bankFolders} dossiers maximum`);
      const parentId = folderField(ctx, user.id, input.parentId);
      if (depthOf(new Map(all.map((f) => [f.id, f])), parentId) >= LIMITS.folderDepth) {
        throw new ServiceError(400, `${LIMITS.folderDepth} niveaux de dossiers maximum`);
      }
      const at = nowIso(ctx);
      const doc: BankFolderDoc = { id: randomUuid(), ownerId: user.id, name: folderName(input.name), parentId, createdAt: at, updatedAt: at };
      ctx.docs.put(BANK_FOLDER, doc);
      return { folder: toFolder(doc) };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/bank\/folders\/([\w-]+)$/,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const folder = ownedFolder(ctx, user.id, ctx.params[0]);
      const input = body(ctx);
      const next: BankFolderDoc = { ...folder, updatedAt: nowIso(ctx) };
      if ('name' in input) next.name = folderName(input.name);
      if ('parentId' in input) {
        const parentId = folderField(ctx, user.id, input.parentId);
        const all = foldersOf(ctx.docs, user.id);
        if (parentId && descendants(all, folder.id).has(parentId)) throw new ServiceError(400, 'Un dossier ne peut pas être rangé dans lui-même');
        if (depthOf(new Map(all.map((f) => [f.id, f])), parentId) + subtreeDepth(all, folder.id) > LIMITS.folderDepth) {
          throw new ServiceError(400, `${LIMITS.folderDepth} niveaux de dossiers maximum`);
        }
        next.parentId = parentId;
      }
      ctx.docs.put(BANK_FOLDER, next);
      return { folder: toFolder(next) };
    },
  },
  {
    /** Supprime un dossier : son contenu (questions et sous-dossiers) remonte dans le dossier parent. */
    method: 'DELETE',
    pattern: /^\/bank\/folders\/([\w-]+)$/,
    handler(ctx) {
      const user = requireTeacher(ctx);
      const folder = ownedFolder(ctx, user.id, ctx.params[0]);
      const at = nowIso(ctx);
      for (const child of foldersOf(ctx.docs, user.id).filter((f) => f.parentId === folder.id)) {
        ctx.docs.put(BANK_FOLDER, { ...child, parentId: folder.parentId, updatedAt: at });
      }
      for (const doc of questionsOf(ctx.docs, user.id).filter((q) => q.folderId === folder.id)) {
        ctx.docs.put(BANK_QUESTION, { ...doc, folderId: folder.parentId, updatedAt: at });
      }
      ctx.docs.delete(BANK_FOLDER, folder.id);
      return { ok: true };
    },
  },
];
