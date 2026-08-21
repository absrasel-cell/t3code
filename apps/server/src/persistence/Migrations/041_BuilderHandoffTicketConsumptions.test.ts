import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_BuilderHandoffTicketConsumptions", (it) => {
  it.effect("creates a durable primary-key JTI consumption ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 25 });
      yield* runMigrations({ toMigrationInclusive: 26 });

      const columns = yield* sql<{
        readonly name: string;
        readonly pk: number;
      }>`PRAGMA table_info(builder_handoff_ticket_consumptions)`;
      assert.equal(columns.find((column) => column.name === "jti")?.pk, 1);

      const indexes = yield* sql<{
        readonly name: string;
      }>`PRAGMA index_list(builder_handoff_ticket_consumptions)`;
      assert.ok(
        indexes.some((index) => index.name === "idx_builder_handoff_consumptions_expires_at"),
      );
    }),
  );
});
