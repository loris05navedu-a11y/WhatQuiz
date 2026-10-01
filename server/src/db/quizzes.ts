import type { MediaItem, Question, QuestionConfig, QuestionInput, QuestionType, Quiz, QuizInput, QuizSummary } from '../../../shared/types';
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
}

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
       FROM quizzes q WHERE q.owner_id = ? ORDER BY q.updated_at DESC`,
      ownerId,
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      imageUrl: row.image_url,
      questionCount: row.question_count,
      gameCount: row.game_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  countByOwner(ownerId: number): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM quizzes WHERE owner_id = ?', ownerId)?.n ?? 0;
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
      questions,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(ownerId: number, input: QuizInput): Quiz {
    const id = this.db.transaction(() => {
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO quizzes (owner_id, title, description, image_url, category) VALUES (?, ?, ?, ?, ?)',
        ownerId,
        input.title,
        input.description,
        input.imageUrl,
        input.category,
      );
      this.insertQuestions(lastInsertRowid, input);
      return lastInsertRowid;
    });
    return this.findById(id)!;
  }

  /** Remplace entièrement le contenu du quiz (les questions sont réécrites dans l'ordre reçu). */
  update(id: number, input: QuizInput): Quiz {
    this.db.transaction(() => {
      this.db.run(
        `UPDATE quizzes SET title = ?, description = ?, image_url = ?, category = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        input.title,
        input.description,
        input.imageUrl,
        input.category,
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
