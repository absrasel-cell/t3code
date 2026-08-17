import { BUILDER_HANDOFF_KEY_ID } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  BuilderHandoffTicketRepository,
  type BuilderHandoffTicketRepositoryError,
  type BuilderHandoffTicketRepositoryShape,
  ConsumeBuilderHandoffTicketInput,
} from "../Services/BuilderHandoffTickets.ts";

function toRepositoryError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): BuilderHandoffTicketRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeBuilderHandoffTicketRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const consumeTicketRow = SqlSchema.findAll({
    Request: ConsumeBuilderHandoffTicketInput,
    Result: Schema.Struct({ jti: Schema.String }),
    execute: ({ claims, consumedAt }) => sql`
      INSERT INTO builder_handoff_ticket_consumptions (
        jti,
        key_id,
        version,
        issuer,
        audience,
        subject,
        workspace_id,
        tenant_key,
        project_key,
        role,
        purpose,
        scope,
        issued_at,
        not_before,
        expires_at,
        consumed_at
      )
      VALUES (
        ${claims.jti},
        ${BUILDER_HANDOFF_KEY_ID},
        ${claims.v},
        ${claims.iss},
        ${claims.aud},
        ${claims.sub},
        ${claims.workspaceId},
        ${claims.tenantKey},
        ${claims.projectKey},
        ${claims.role},
        ${claims.purpose},
        ${claims.scope},
        ${claims.iat},
        ${claims.nbf},
        ${claims.exp},
        ${consumedAt}
      )
      ON CONFLICT(jti) DO NOTHING
      RETURNING jti AS "jti"
    `,
  });

  const consumeOnce: BuilderHandoffTicketRepositoryShape["consumeOnce"] = (input) =>
    consumeTicketRow(input).pipe(
      Effect.mapError(
        toRepositoryError(
          "BuilderHandoffTicketRepository.consumeOnce:query",
          "BuilderHandoffTicketRepository.consumeOnce:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.length === 1),
    );

  return { consumeOnce } satisfies BuilderHandoffTicketRepositoryShape;
});

export const BuilderHandoffTicketRepositoryLive = Layer.effect(
  BuilderHandoffTicketRepository,
  makeBuilderHandoffTicketRepository,
);
