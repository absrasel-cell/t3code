import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sessionColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;

  if (!sessionColumns.some((column) => column.name === "builder_scope_json")) {
    yield* sql`ALTER TABLE auth_sessions ADD COLUMN builder_scope_json TEXT`;
  }

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS trg_auth_sessions_builder_scope_immutable
    BEFORE UPDATE OF builder_scope_json ON auth_sessions
    WHEN OLD.builder_scope_json IS NOT NEW.builder_scope_json
    BEGIN
      SELECT RAISE(ABORT, 'builder session scope is immutable');
    END
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS builder_project_scopes (
      project_id TEXT PRIMARY KEY,
      builder_scope_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS builder_thread_scopes (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      auth_session_id TEXT NOT NULL,
      builder_scope_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES builder_project_scopes(project_id),
      FOREIGN KEY (auth_session_id) REFERENCES auth_sessions(session_id)
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_builder_thread_scopes_project
    ON builder_thread_scopes(project_id, thread_id)
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS trg_builder_project_scope_immutable
    BEFORE UPDATE ON builder_project_scopes
    BEGIN
      SELECT RAISE(ABORT, 'builder project scope is immutable');
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS trg_builder_thread_scope_immutable
    BEFORE UPDATE ON builder_thread_scopes
    BEGIN
      SELECT RAISE(ABORT, 'builder thread scope is immutable');
    END
  `;
});
