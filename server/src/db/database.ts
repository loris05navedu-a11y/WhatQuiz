import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './schema';

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
    MIGRATIONS.slice(current).forEach((sql, offset) => {
      this.transaction(() => {
        this.raw.exec(sql);
        this.run('INSERT INTO migrations (version) VALUES (?)', current + offset + 1);
      });
    });
  }
}
