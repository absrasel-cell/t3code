import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS builder_handoff_ticket_consumptions (
      jti TEXT PRIMARY KEY,
      key_id TEXT NOT NULL CHECK (key_id = 'redxtrm-builder-hs256-v1'),
      version INTEGER NOT NULL CHECK (version = 1),
      issuer TEXT NOT NULL CHECK (issuer = 'redxtrm-dashboard'),
      audience TEXT NOT NULL,
      subject TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      tenant_key TEXT NOT NULL,
      project_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      purpose TEXT NOT NULL CHECK (purpose = 'builder_handoff'),
      scope TEXT NOT NULL CHECK (scope = 'builder:connect'),
      issued_at INTEGER NOT NULL,
      not_before INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at TEXT NOT NULL,
      CHECK (workspace_id = tenant_key),
      CHECK (not_before = issued_at),
      CHECK (expires_at - issued_at BETWEEN 30 AND 300)
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_builder_handoff_consumptions_expires_at
    ON builder_handoff_ticket_consumptions(expires_at)
  `;
});
