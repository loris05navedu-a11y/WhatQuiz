import { generateShareCode, quizMetaFrom } from '../../../shared/quizMeta';
import type {
  Difficulty,
  MediaItem,
  Question,
  QuestionConfig,
  QuestionInput,
  QuestionType,
  Quiz,
  QuizInput,
  QuizMeta,
  QuizStatus,
  QuizSummary,
  QuizVisibility,
} from '../../../shared/types';
import type { Database } from './database';

interface QuizRow {
  id: number;
  owner_id: number;
  title: string;
  description: string;
  image_url: string | null;
  category: string;
  created_at: string;
  updated_at: string;
  status: QuizStatus;
  visibility: QuizVisibility;
  access_code: string | null;
  meta: string;
  deleted_at: string | null;
}

/** Métadonnées secondaires des quiz, stockées en JSON dans `quizzes.meta`. */
interface StoredMeta {
  subcategory?: string;
  tags?: string[];
  difficulty?: Difficulty | null;
  level?: string;
}

function toMeta(row: QuizRow): QuizMeta {
  let stored: StoredMeta = {};
  try {
    stored = JSON.parse(row.meta) as StoredMeta;
  } catch {
    // Métadonnées illisibles : valeurs par défaut.
  }
  return {
    status: row.status,
    visibility: row.visibility,
    accessCode: row.access_code,
    subcategory: stored.subcategory ?? '',
    tags: stored.tags ?? [],
    difficulty: stored.difficulty ?? null,
    level: stored.level ?? '',
  };
}

const writeMeta = (meta: QuizMeta): string =>
  JSON.stringify({ subcategory: meta.subcategory, tags: meta.tags, difficulty: meta.difficulty, level: meta.level } satisfies StoredMeta);

interface SummaryRow extends QuizRow {
  question_count: number;
  game_count: number;
}

interface QuestionRow {
  id: number;
  position: number;
  type: QuestionType;
  text: string;
  image_url: string | null;
  time_limit: number;
  points: number;
  points_enabled: number;
  extra: string;
}

interface AnswerRow {
  question_id: number;
  text: string;
  is_correct: number;
  match_text: string | null;
}

/** Champs propres aux types récents, stockés en JSON dans `questions.extra`. */
interface QuestionExtra {
  explanation?: string;
  bonus?: boolean;
  media?: MediaItem[];
  config?: QuestionConfig;
}

function readExtra(raw: string): QuestionExtra {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' ? (value as QuestionExtra) : {};
  } catch {
    return {};
  }
}

function writeExtra(question: QuestionInput): string {
  const extra: QuestionExtra = {};
  if (question.explanation) extra.explanation = question.explanation;
  if (question.bonus) extra.bonus = true;
  if (question.media?.length) extra.media = question.media;
  if (question.config) extra.config = question.config;
  return JSON.stringify(extra);
}

export class QuizRepository {
  constructor(private readonly db: Database) {}

  listByOwner(ownerId: number): QuizSummary[] {
    const rows = this.db.all<SummaryRow>(
      `SELECT q.*,
         (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
         (SELECT COUNT(*) FROM game_sessions WHERE quiz_id = q.id AND status = 'ended') AS game_count
       FROM quizzes q WHERE q.owner_id = ? AND q.deleted_at IS NULL ORDER BY q.updated_at DESC`,
      ownerId,
    );
    return rows.map((row) => this.toSummary(row));
  }

  /** Quiz publiés et publics des autres professeurs (bibliothèque). */
  listPublic(excludeOwnerId: number, limit = 100): (QuizSummary & { ownerName: string })[] {
    const rows = this.db.all<SummaryRow & { owner_name: string }>(
      `SELECT q.*, u.display_name AS owner_name,
         (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
         (SELECT COUNT(*) FROM game_sessions WHERE quiz_id = q.id AND status = 'ended') AS game_count
       FROM quizzes q JOIN users u ON u.id = q.owner_id
       WHERE q.visibility = 'public' AND q.status = 'published' AND q.deleted_at IS NULL AND q.owner_id != ?
       ORDER BY q.updated_at DESC LIMIT ?`,
      excludeOwnerId,
      limit,
    );
    return rows.map((row) => ({ ...this.toSummary(row), ownerName: row.owner_name }));
  }

  isDeleted(id: number): boolean {
    return this.db.get<{ deleted_at: string | null }>('SELECT deleted_at FROM quizzes WHERE id = ?', id)?.deleted_at != null;
  }

  /** Quiz non supprimé appartenant à l'utilisateur. */
  findOwned(ownerId: number, id: number): Quiz | undefined {
    const row = this.db.get<{ id: number }>('SELECT id FROM quizzes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
    return row ? this.findById(row.id) : undefined;
  }

  findByAccessCode(code: string): Quiz | undefined {
    const row = this.db.get<{ id: number }>(
      `SELECT id FROM quizzes WHERE access_code = ? AND visibility != 'private' AND status = 'published' AND deleted_at IS NULL`,
      code,
    );
    return row ? this.findById(row.id) : undefined;
  }

  private toSummary(row: SummaryRow): QuizSummary {
    return {
      ...toMeta(row),
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      imageUrl: row.image_url,
      questionCount: row.question_count,
      gameCount: row.game_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  countByOwner(ownerId: number): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM quizzes WHERE owner_id = ? AND deleted_at IS NULL', ownerId)?.n ?? 0;
  }

  findById(id: number): Quiz | undefined {
    const row = this.db.get<QuizRow>('SELECT * FROM quizzes WHERE id = ?', id);
    if (!row) return undefined;
    const questionRows = this.db.all<QuestionRow>('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position', id);
    const answerRows = this.db.all<AnswerRow>(
      `SELECT a.question_id, a.text, a.is_correct, a.match_text FROM answers a
       JOIN questions q ON q.id = a.question_id WHERE q.quiz_id = ? ORDER BY a.question_id, a.position`,
      id,
    );
    const questions: Question[] = questionRows.map((q) => {
      const extra = readExtra(q.extra);
      return {
        id: q.id,
        position: q.position,
        type: q.type,
        text: q.text,
        imageUrl: q.image_url,
        timeLimit: q.time_limit,
        points: q.points,
        pointsEnabled: q.points_enabled === 1,
        answers: answerRows
          .filter((a) => a.question_id === q.id)
          .map((a) => (a.match_text === null ? { text: a.text, isCorrect: a.is_correct === 1 } : { text: a.text, isCorrect: a.is_correct === 1, match: a.match_text })),
        explanation: extra.explanation ?? '',
        bonus: extra.bonus ?? false,
        media: extra.media ?? [],
        ...(extra.config ? { config: extra.config } : {}),
      };
    });
    return {
      id: row.id,
      ownerId: row.owner_id,
      title: row.title,
      description: row.description,
      imageUrl: row.image_url,
      category: row.category,
      ...toMeta(row),
      questions,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Un code d'accès est attribué dès que le quiz est partagé (et conservé ensuite). */
  private accessCodeFor(input: QuizInput, current: string | null): string | null {
    if (current || (input.visibility ?? 'private') === 'private') return current;
    for (;;) {
      const code = generateShareCode();
      if (!this.db.get('SELECT 1 FROM quizzes WHERE access_code = ?', code)) return code;
    }
  }

  create(ownerId: number, input: QuizInput): Quiz {
    const meta = quizMetaFrom(input, this.accessCodeFor(input, null));
    const id = this.db.transaction(() => {
      const { lastInsertRowid } = this.db.run(
        `INSERT INTO quizzes (owner_id, title, description, image_url, category, status, visibility, access_code, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ownerId,
        input.title,
        input.description,
        input.imageUrl,
        input.category,
        meta.status,
        meta.visibility,
        meta.accessCode,
        writeMeta(meta),
      );
      this.insertQuestions(lastInsertRowid, input);
      return lastInsertRowid;
    });
    return this.findById(id)!;
  }

  /** Remplace entièrement le contenu du quiz (les questions sont réécrites dans l'ordre reçu). */
  update(id: number, input: QuizInput): Quiz {
    const current = this.db.get<{ access_code: string | null }>('SELECT access_code FROM quizzes WHERE id = ?', id);
    const meta = quizMetaFrom(input, this.accessCodeFor(input, current?.access_code ?? null));
    this.db.transaction(() => {
      this.db.run(
        `UPDATE quizzes SET title = ?, description = ?, image_url = ?, category = ?, status = ?, visibility = ?, access_code = ?, meta = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        input.title,
        input.description,
        input.imageUrl,
        input.category,
        meta.status,
        meta.visibility,
        meta.accessCode,
        writeMeta(meta),
        id,
      );
      this.db.run('DELETE FROM questions WHERE quiz_id = ?', id);
      this.insertQuestions(id, input);
    });
    return this.findById(id)!;
  }

  delete(id: number): void {
    this.db.run('DELETE FROM quizzes WHERE id = ?', id);
  }

  private insertQuestions(quizId: number, input: QuizInput): void {
    input.questions.forEach((question, position) => {
      const { lastInsertRowid: questionId } = this.db.run(
        `INSERT INTO questions (quiz_id, position, type, text, image_url, time_limit, points, points_enabled, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        quizId,
        position,
        question.type,
        question.text,
        question.imageUrl,
        question.timeLimit,
        question.points,
        question.pointsEnabled ? 1 : 0,
        writeExtra(question),
      );
      question.answers.forEach((answer, answerPosition) => {
        this.db.run(
          'INSERT INTO answers (question_id, position, text, is_correct, match_text) VALUES (?, ?, ?, ?, ?)',
          questionId,
          answerPosition,
          answer.text,
          answer.isCorrect ? 1 : 0,
          answer.match ?? null,
        );
      });
    });
  }
}
