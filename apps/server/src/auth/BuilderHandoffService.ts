import type { BuilderHandoffTicketClaims } from "@t3tools/contracts";
import { Context, Data } from "effect";
import type { Effect } from "effect";

export type BuilderHandoffRejectionReason =
  | "malformed"
  | "bad_signature"
  | "invalid_claims"
  | "expired"
  | "already_used"
  | "unavailable";

export class BuilderHandoffError extends Data.TaggedError("BuilderHandoffError")<{
  readonly reason: BuilderHandoffRejectionReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface BuilderHandoffServiceShape {
  /** Verifies and durably consumes a ticket before releasing its immutable scope. */
  readonly exchange: (
    ticket: string,
  ) => Effect.Effect<BuilderHandoffTicketClaims, BuilderHandoffError>;
}

export class BuilderHandoffService extends Context.Service<
  BuilderHandoffService,
  BuilderHandoffServiceShape
>()("t3/auth/Services/BuilderHandoff/BuilderHandoffService") {}
