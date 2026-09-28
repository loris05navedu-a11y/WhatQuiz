import { existsSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  uploadDir: string;
  sessionDays: number;
  cookieSecure: boolean;
  maxPlayers: number;
  isProduction: boolean;
}

export function loadConfig(): AppConfig {
  return {
    port: intFromEnv('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    databasePath: process.env.DATABASE_PATH || path.resolve('data/whatquiz.db'),
    uploadDir: path.resolve(process.env.UPLOAD_DIR || 'data/uploads'),
    sessionDays: intFromEnv('SESSION_DAYS', 14),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    maxPlayers: intFromEnv('MAX_PLAYERS', 100),
    isProduction: process.env.NODE_ENV === 'production',
  };
}
