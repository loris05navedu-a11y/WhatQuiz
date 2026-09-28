import type { PublicUser, Role } from '../../../shared/types';
import type { Database } from './database';

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: Role;
  is_demo: number;
  created_at: string;
}

export interface UserRecord extends PublicUser {
  passwordHash: string;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isDemo: row.is_demo === 1,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  };
}

export function toPublicUser({ passwordHash: _hash, ...user }: UserRecord): PublicUser {
  return user;
}

export class UserRepository {
  constructor(private readonly db: Database) {}

  findById(id: number): UserRecord | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    return row && toRecord(row);
  }

  findByEmail(email: string): UserRecord | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim());
    return row && toRecord(row);
  }

  create(input: { email: string; passwordHash: string; displayName: string; role: Role; isDemo?: boolean }): UserRecord {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO users (email, password_hash, display_name, role, is_demo) VALUES (?, ?, ?, ?, ?)',
      input.email.trim(),
      input.passwordHash,
      input.displayName.trim(),
      input.role,
      input.isDemo ? 1 : 0,
    );
    return this.findById(lastInsertRowid)!;
  }

  updateProfile(id: number, input: { email: string; displayName: string }): void {
    this.db.run(
      `UPDATE users SET email = ?, display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      input.email.trim(),
      input.displayName.trim(),
      id,
    );
  }

  updatePassword(id: number, passwordHash: string): void {
    this.db.run(
      `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      passwordHash,
      id,
    );
  }

  delete(id: number): void {
    this.db.run('DELETE FROM users WHERE id = ?', id);
  }

  /** Supprime les comptes de démonstration plus anciens que `maxAgeHours`. */
  purgeDemoAccounts(maxAgeHours: number): number {
    const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
    return this.db.run('DELETE FROM users WHERE is_demo = 1 AND created_at < ?', cutoff).changes;
  }
}
