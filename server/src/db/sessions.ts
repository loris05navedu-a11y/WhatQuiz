import { createHash, randomBytes } from 'node:crypto';
import type { Database } from './database';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Sessions côté serveur : seul le hash du jeton est stocké, le jeton brut vit dans un cookie httpOnly. */
export class SessionRepository {
  constructor(
    private readonly db: Database,
    private readonly lifetimeMs: number,
  ) {}

  create(userId: number): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.lifetimeMs;
    this.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', hashToken(token), userId, expiresAt);
    return { token, expiresAt };
  }

  findUserId(token: string): number | null {
    const row = this.db.get<{ user_id: number; expires_at: number }>(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
      hashToken(token),
    );
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.delete(token);
      return null;
    }
    return row.user_id;
  }

  delete(token: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
  }

  deleteOthers(userId: number, keepToken: string): void {
    this.db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, hashToken(keepToken));
  }

  purgeExpired(): void {
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  }
}
