import type { DocStore, StoredDoc } from '../../../shared/documents';
import type { Database } from './database';

/** Stockage de documents (JSON) dans la table `documents`. */
export class SqlDocStore implements DocStore {
  constructor(private readonly db: Database) {}

  get<T extends StoredDoc>(kind: string, id: string): T | undefined {
    const row = this.db.get<{ data: string }>('SELECT data FROM documents WHERE kind = ? AND id = ?', kind, id);
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  list<T extends StoredDoc>(kind: string, ownerId?: number): T[] {
    const rows =
      ownerId === undefined
        ? this.db.all<{ data: string }>('SELECT data FROM documents WHERE kind = ? ORDER BY created_at', kind)
        : this.db.all<{ data: string }>('SELECT data FROM documents WHERE kind = ? AND owner_id = ? ORDER BY created_at', kind, ownerId);
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  put<T extends StoredDoc>(kind: string, doc: T): void {
    this.db.run(
      `INSERT INTO documents (kind, id, owner_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, id) DO UPDATE SET owner_id = excluded.owner_id, data = excluded.data, updated_at = excluded.updated_at`,
      kind,
      doc.id,
      doc.ownerId,
      JSON.stringify(doc),
      doc.createdAt,
      doc.updatedAt,
    );
  }

  delete(kind: string, id: string): void {
    this.db.run('DELETE FROM documents WHERE kind = ? AND id = ?', kind, id);
  }
}
