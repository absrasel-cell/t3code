import {
  BUILDER_HANDOFF_ISSUER,
  BUILDER_HANDOFF_KEY_ID,
  BUILDER_HANDOFF_PURPOSE,
  BUILDER_HANDOFF_SCOPE,
  BUILDER_HANDOFF_VERSION,
  type BuilderHandoffTicketClaims,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { TestClock } from "effect/testing";
import { createHmac } from "node:crypto";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import type { BuilderHandoffConfig } from "../builderHandoffConfig.ts";
import { BuilderHandoffService } from "../Services/BuilderHandoff.ts";
import { makeBuilderHandoffServiceLive } from "./BuilderHandoff.ts";

const secretText = "builder-test-secret-with-more-than-thirty-two-bytes";
const config: BuilderHandoffConfig = {
  audience: "https://builder.redxtrm.example",
  secret: Buffer.from(secretText, "utf8"),
};
const baseClaims: BuilderHandoffTicketClaims = {
  v: BUILDER_HANDOFF_VERSION,
  iss: BUILDER_HANDOFF_ISSUER,
  aud: config.audience,
  sub: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  tenantKey: "22222222-2222-4222-8222-222222222222",
  projectKey: "domain:client-example",
  role: "member",
  purpose: BUILDER_HANDOFF_PURPOSE,
  scope: BUILDER_HANDOFF_SCOPE,
  oneTime: true,
  iat: 0,
  nbf: 0,
  exp: 60,
  jti: "33333333-3333-4333-8333-333333333333",
};

function signTicket(
  claims: Record<string, unknown> = baseClaims,
  header: Record<string, unknown> = {
    alg: "HS256",
    typ: "JWT",
    kid: BUILDER_HANDOFF_KEY_ID,
  },
): string {
  const headerPart = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const payloadPart = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = createHmac("sha256", secretText)
    .update(signingInput, "utf8")
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

const testLayer = Layer.merge(
  makeBuilderHandoffServiceLive(config).pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  TestClock.layer(),
);

it.effect("atomically consumes a valid builder ticket exactly once under concurrency", () =>
  Effect.gen(function* () {
    const handoff = yield* BuilderHandoffService;
    const sql = yield* SqlClient.SqlClient;
    const ticket = signTicket();

    const results = yield* Effect.all(
      [Effect.result(handoff.exchange(ticket)), Effect.result(handoff.exchange(ticket))],
      { concurrency: "unbounded" },
    );
    const successes = results.filter((result) => result._tag === "Success");
    const failures = results.filter((result) => result._tag === "Failure");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?._tag === "Failure" ? failures[0].failure.reason : null).toBe(
      "already_used",
    );

    const rows = yield* sql<{
      readonly jti: string;
      readonly subject: string;
      readonly tenantKey: string;
      readonly projectKey: string;
      readonly role: string;
    }>`
      SELECT
        jti,
        subject,
        tenant_key AS "tenantKey",
        project_key AS "projectKey",
        role
      FROM builder_handoff_ticket_consumptions
    `;
    expect(rows).toEqual([
      {
        jti: baseClaims.jti,
        subject: baseClaims.sub,
        tenantKey: baseClaims.tenantKey,
        projectKey: baseClaims.projectKey,
        role: baseClaims.role,
      },
    ]);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects tampering before it consumes a JTI", () =>
  Effect.gen(function* () {
    const handoff = yield* BuilderHandoffService;
    const sql = yield* SqlClient.SqlClient;
    const ticket = signTicket();
    const [header, payload, signature] = ticket.split(".") as [string, string, string];
    const error = yield* Effect.flip(handoff.exchange(`${header}.${payload}A.${signature}`));

    expect(error.reason).toBe("bad_signature");
    const rows = yield* sql`SELECT jti FROM builder_handoff_ticket_consumptions`;
    expect(rows).toHaveLength(0);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects the wrong audience and unknown payload fields", () =>
  Effect.gen(function* () {
    const handoff = yield* BuilderHandoffService;

    const wrongAudience = yield* Effect.flip(
      handoff.exchange(signTicket({ ...baseClaims, aud: "https://other.example" })),
    );
    const unknownField = yield* Effect.flip(
      handoff.exchange(signTicket({ ...baseClaims, unsupported: "not-allowed" })),
    );

    expect(wrongAudience.reason).toBe("invalid_claims");
    expect(unknownField.reason).toBe("invalid_claims");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("enforces the fixed issuer, scope, and bounded lifetime", () =>
  Effect.gen(function* () {
    const handoff = yield* BuilderHandoffService;

    const wrongIssuer = yield* Effect.flip(
      handoff.exchange(signTicket({ ...baseClaims, iss: "other-dashboard" })),
    );
    const wrongScope = yield* Effect.flip(
      handoff.exchange(signTicket({ ...baseClaims, scope: "builder:admin" })),
    );
    const excessiveLifetime = yield* Effect.flip(
      handoff.exchange(signTicket({ ...baseClaims, exp: 301 })),
    );

    expect(wrongIssuer.reason).toBe("invalid_claims");
    expect(wrongScope.reason).toBe("invalid_claims");
    expect(excessiveLifetime.reason).toBe("invalid_claims");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects an expired ticket without consuming it", () =>
  Effect.gen(function* () {
    const handoff = yield* BuilderHandoffService;
    const sql = yield* SqlClient.SqlClient;
    yield* TestClock.adjust("60 seconds");

    const error = yield* Effect.flip(handoff.exchange(signTicket()));

    expect(error.reason).toBe("expired");
    const rows = yield* sql`SELECT jti FROM builder_handoff_ticket_consumptions`;
    expect(rows).toHaveLength(0);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("requires the fixed protected key identifier", () =>
  Effect.gen(function* () {
    const handoff = yield* BuilderHandoffService;
    const error = yield* Effect.flip(
      handoff.exchange(
        signTicket(baseClaims, {
          alg: "HS256",
          typ: "JWT",
          kid: "redxtrm-builder-hs256-v2",
        }),
      ),
    );

    expect(error.reason).toBe("invalid_claims");
  }).pipe(Effect.provide(testLayer)),
);
