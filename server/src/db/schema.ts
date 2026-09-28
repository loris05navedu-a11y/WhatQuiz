/** Schéma SQLite. Chaque migration est appliquée une seule fois (table `migrations`). */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    is_demo       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE quizzes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url   TEXT,
    category    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_quizzes_owner ON quizzes(owner_id);

  CREATE TABLE questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id        INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('single', 'multiple', 'truefalse', 'text')),
    text           TEXT NOT NULL,
    image_url      TEXT,
    time_limit     INTEGER NOT NULL,
    points         INTEGER NOT NULL,
    points_enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_questions_quiz ON questions(quiz_id, position);

  CREATE TABLE answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    text        TEXT NOT NULL,
    is_correct  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_answers_question ON answers(question_id, position);

  -- Une partie conserve une copie figée du quiz : modifier le quiz ensuite ne fausse pas l'historique.
  CREATE TABLE game_sessions (
    id             TEXT PRIMARY KEY,
    code           TEXT NOT NULL,
    quiz_id        INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
    host_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_title     TEXT NOT NULL,
    quiz_snapshot  TEXT NOT NULL,
    settings       TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('lobby', 'running', 'ended', 'aborted')),
    questions_played INTEGER NOT NULL DEFAULT 0,
    results_visible  INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at     TEXT,
    ended_at       TEXT
  );
  CREATE INDEX idx_games_host ON game_sessions(host_id, created_at);
  CREATE INDEX idx_games_quiz ON game_sessions(quiz_id);

  CREATE TABLE players (
    id        TEXT PRIMARY KEY,
    game_id   TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    nickname  TEXT NOT NULL,
    score     INTEGER NOT NULL DEFAULT 0,
    kicked    INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_players_game ON players(game_id);
  CREATE INDEX idx_players_user ON players(user_id);

  CREATE TABLE player_answers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id        TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    question_index INTEGER NOT NULL,
    answer         TEXT NOT NULL,
    is_correct     INTEGER NOT NULL,
    points         INTEGER NOT NULL,
    response_ms    INTEGER NOT NULL,
    answered_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (player_id, question_index)
  );
  CREATE INDEX idx_player_answers_game ON player_answers(game_id, question_index);

  CREATE TABLE game_results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id         TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    rank            INTEGER NOT NULL,
    score           INTEGER NOT NULL,
    correct_count   INTEGER NOT NULL,
    answered_count  INTEGER NOT NULL,
    avg_response_ms INTEGER,
    UNIQUE (game_id, player_id)
  );
  `,
];
