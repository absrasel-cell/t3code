import { Schema } from "effect";

export const BUILDER_HANDOFF_VERSION = 1 as const;
export const BUILDER_HANDOFF_ISSUER = "redxtrm-dashboard" as const;
export const BUILDER_HANDOFF_KEY_ID = "redxtrm-builder-hs256-v1" as const;
export const BUILDER_HANDOFF_PURPOSE = "builder_handoff" as const;
export const BUILDER_HANDOFF_SCOPE = "builder:connect" as const;

const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
const OpaqueProjectKey = Schema.String.check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(120))
  .check(Schema.isPattern(/^[a-zA-Z0-9:_-]+$/));
const EpochSeconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const BuilderHandoffProtectedHeader = Schema.Struct({
  alg: Schema.Literal("HS256"),
  typ: Schema.Literal("JWT"),
  kid: Schema.Literal(BUILDER_HANDOFF_KEY_ID),
});
export type BuilderHandoffProtectedHeader = typeof BuilderHandoffProtectedHeader.Type;

export const BuilderHandoffTicketClaims = Schema.Struct({
  v: Schema.Literal(BUILDER_HANDOFF_VERSION),
  iss: Schema.Literal(BUILDER_HANDOFF_ISSUER),
  aud: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(2_048)),
  sub: Uuid,
  workspaceId: Uuid,
  tenantKey: Uuid,
  projectKey: OpaqueProjectKey,
  role: Schema.Literals(["owner", "member"]),
  purpose: Schema.Literal(BUILDER_HANDOFF_PURPOSE),
  scope: Schema.Literal(BUILDER_HANDOFF_SCOPE),
  oneTime: Schema.Literal(true),
  iat: EpochSeconds,
  nbf: EpochSeconds,
  exp: EpochSeconds,
  jti: Uuid,
});
export type BuilderHandoffTicketClaims = typeof BuilderHandoffTicketClaims.Type;
