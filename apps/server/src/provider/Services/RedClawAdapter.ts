/**
 * RedClawAdapter - isolated Client Dev BFF implementation of the provider
 * adapter contract.
 *
 * Credentials are server-only and the service is not registered unless the
 * environment configuration passes strict validation.
 */
import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface RedClawAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "redclaw";
}

export class RedClawAdapter extends Context.Service<RedClawAdapter, RedClawAdapterShape>()(
  "t3/provider/Services/RedClawAdapter",
) {}
