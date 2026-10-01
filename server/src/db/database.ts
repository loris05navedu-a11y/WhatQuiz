import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './schema';

export type SqlParam = SQLInputValue;

/** Petite surcouche typée autour de `node:sqlite` (intégré à Node, aucune compilation native requise). */
export class Database {
  readonly raw: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ':memory:') mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    this.raw = new DatabaseSync(filePath);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    if (filePath !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlParam[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
    const result = this.raw.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  transaction<T>(work: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const result = work();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }

  private migrate(): void {
    this.raw.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
    const row = this.get<{ version: number | null }>('SELECT MAX(version) AS version FROM migrations');
    const current = row?.version ?? 0;
    MIGRATIONS.slice(current).forEach((migration, offset) => this.apply(migration, current + offset + 1));
  }

  /**
   * Une migration qui reconstruit une table (pour changer une contrainte CHECK, impossible avec ALTER TABLE)
   * désactive les clés étrangères, sinon supprimer l'ancienne table effacerait les lignes liées en cascade.
   * Procédure recommandée par SQLite : https://www.sqlite.org/lang_altertable.html#otheralter
   */
  private apply(migration: Migration, version: number): void {
    const { sql, rebuildsTables } = typeof migration === 'string' ? { sql: migration, rebuildsTables: false } : migration;
    if (rebuildsTables) this.raw.exec('PRAGMA foreign_keys = OFF;');
    try {
      this.transaction(() => {
        this.raw.exec(sql);
        if (rebuildsTables && this.all('PRAGMA foreign_key_check').length > 0) throw new Error(`Migration ${version} : clés étrangères invalides`);
        this.run('INSERT INTO migrations (version) VALUES (?)', version);
      });
    } finally {
      if (rebuildsTables) this.raw.exec('PRAGMA foreign_keys = ON;');
    }
  }
}
