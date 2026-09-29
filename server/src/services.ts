import type { AppConfig } from './config';
import { Database } from './db/database';
import { GameRepository } from './db/games';
import { QuizRepository } from './db/quizzes';
import { SessionRepository } from './db/sessions';
import { UserRepository } from './db/users';

/** Conteneur des dépendances partagées par les routes et le temps réel. */
export interface Services {
  config: AppConfig;
  db: Database;
  users: UserRepository;
  sessions: SessionRepository;
  quizzes: QuizRepository;
  games: GameRepository;
}

export function createServices(config: AppConfig): Services {
  const db = new Database(config.databasePath);
  return {
    config,
    db,
    users: new UserRepository(db, config.adminEmails),
    sessions: new SessionRepository(db, config.sessionDays * 86_400_000),
    quizzes: new QuizRepository(db),
    games: new GameRepository(db),
  };
}
