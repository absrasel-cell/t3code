import { BUILDER_HANDOFF_KEY_ID, BuilderHandoffTicketClaims } from "@t3tools/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export const ConsumeBuilderHandoffTicketInput = Schema.Struct({
  keyId: Schema.Literal(BUILDER_HANDOFF_KEY_ID),
  claims: BuilderHandoffTicketClaims,
  consumedAt: Schema.DateTimeUtcFromString,
});
export type ConsumeBuilderHandoffTicketInput = typeof ConsumeBuilderHandoffTicketInput.Type;

export type BuilderHandoffTicketRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export interface BuilderHandoffTicketRepositoryShape {
  /** Atomically returns true only for the first durable insertion of this JTI. */
  readonly consumeOnce: (
    input: ConsumeBuilderHandoffTicketInput,
  ) => Effect.Effect<boolean, BuilderHandoffTicketRepositoryError>;
}

export class BuilderHandoffTicketRepository extends Context.Service<
  BuilderHandoffTicketRepository,
  BuilderHandoffTicketRepositoryShape
>()("t3/persistence/Services/BuilderHandoffTickets/BuilderHandoffTicketRepository") {}
