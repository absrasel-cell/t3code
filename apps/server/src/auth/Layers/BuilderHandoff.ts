import { BUILDER_HANDOFF_KEY_ID, BuilderHandoffTicketClaims } from "@t3tools/contracts";
import { Clock, DateTime, Effect, Layer, Schema } from "effect";
import { createHmac, timingSafeEqual } from "node:crypto";

import { BuilderHandoffTicketRepositoryLive } from "../../persistence/Layers/BuilderHandoffTickets.ts";
import { BuilderHandoffTicketRepository } from "../../persistence/Services/BuilderHandoffTickets.ts";
import type { BuilderHandoffConfig } from "../builderHandoffConfig.ts";
import {
  BuilderHandoffError,
  BuilderHandoffService,
  type BuilderHandoffRejectionReason,
  type BuilderHandoffServiceShape,
} from "../Services/BuilderHandoff.ts";

const TICKET_MAX_LENGTH = 8_192;
const TICKET_TTL_MIN_SECONDS = 30;
const TICKET_TTL_MAX_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 5;
const BASE64_URL_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PROTECTED_HEADER = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT", kid: BUILDER_HANDOFF_KEY_ID }),
  "utf8",
).toString("base64url");

const reject = (
  reason: BuilderHandoffRejectionReason,
  message: string,
  cause?: unknown,
): BuilderHandoffError => new BuilderHandoffError({ reason, message, ...(cause ? { cause } : {}) });

function verifySignature(signingInput: string, signaturePart: string, secret: Uint8Array): boolean {
  const expected = createHmac("sha256", Buffer.from(secret)).update(signingInput, "utf8").digest();
  const provided = Buffer.from(signaturePart, "base64url");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function decodeClaims(payloadPart: string) {
  return Effect.try({
    try: () => JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as unknown,
    catch: (cause) => reject("malformed", "Malformed builder handoff ticket.", cause),
  }).pipe(
    Effect.flatMap((payload) =>
      Schema.decodeUnknownEffect(BuilderHandoffTicketClaims)(payload, {
        onExcessProperty: "error",
      }),
    ),
    Effect.mapError((cause) =>
      cause instanceof BuilderHandoffError
        ? cause
        : reject("invalid_claims", "Invalid builder handoff claims.", cause),
    ),
  );
}

export const makeBuilderHandoffService = (config: BuilderHandoffConfig) =>
  Effect.gen(function* () {
    const consumedTickets = yield* BuilderHandoffTicketRepository;

    const exchange: BuilderHandoffServiceShape["exchange"] = (ticket) =>
      Effect.gen(function* () {
        if (ticket.length === 0 || ticket.length > TICKET_MAX_LENGTH) {
          return yield* reject("malformed", "Malformed builder handoff ticket.");
        }
        const parts = ticket.split(".");
        if (parts.length !== 3 || parts.some((part) => !BASE64_URL_PATTERN.test(part))) {
          return yield* reject("malformed", "Malformed builder handoff ticket.");
        }
        const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
        if (headerPart !== PROTECTED_HEADER) {
          return yield* reject("invalid_claims", "Invalid builder handoff header.");
        }
        const signingInput = `${headerPart}.${payloadPart}`;
        if (!verifySignature(signingInput, signaturePart, config.secret)) {
          return yield* reject("bad_signature", "Invalid builder handoff signature.");
        }

        const claims = yield* decodeClaims(payloadPart);
        if (
          claims.aud !== config.audience ||
          claims.workspaceId !== claims.tenantKey ||
          claims.nbf !== claims.iat ||
          claims.exp - claims.iat < TICKET_TTL_MIN_SECONDS ||
          claims.exp - claims.iat > TICKET_TTL_MAX_SECONDS
        ) {
          return yield* reject("invalid_claims", "Invalid builder handoff claims.");
        }

        const nowMilliseconds = yield* Clock.currentTimeMillis;
        const nowSeconds = Math.floor(nowMilliseconds / 1_000);
        if (claims.exp <= nowSeconds) {
          return yield* reject("expired", "Builder handoff ticket expired.");
        }
        if (
          claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
          claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS
        ) {
          return yield* reject("invalid_claims", "Builder handoff ticket is not active.");
        }

        const consumed = yield* consumedTickets
          .consumeOnce({
            keyId: BUILDER_HANDOFF_KEY_ID,
            claims,
            consumedAt: DateTime.makeUnsafe(nowMilliseconds),
          })
          .pipe(
            Effect.mapError((cause) =>
              reject("unavailable", "Builder handoff persistence failed.", cause),
            ),
          );
        if (!consumed) {
          return yield* reject("already_used", "Builder handoff ticket already used.");
        }

        return claims;
      });

    return { exchange } satisfies BuilderHandoffServiceShape;
  });

export const makeBuilderHandoffServiceLive = (config: BuilderHandoffConfig) =>
  Layer.effect(BuilderHandoffService, makeBuilderHandoffService(config)).pipe(
    Layer.provide(BuilderHandoffTicketRepositoryLive),
  );

export const BuilderHandoffServiceDisabled = Layer.succeed(BuilderHandoffService, {
  exchange: () => Effect.fail(reject("unavailable", "Builder handoff is not configured.")),
} satisfies BuilderHandoffServiceShape);
