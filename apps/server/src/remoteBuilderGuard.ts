import {
  RemoteBuilderAccessDeniedError,
  type RemoteBuilderRestrictedCapability,
} from "@t3tools/contracts";
import { Effect, Stream } from "effect";

import { isRemoteBuilderMode, type ServerAppMode } from "./remoteBuilderMode.ts";

export function makeRemoteBuilderDenial(
  capability: RemoteBuilderRestrictedCapability,
): RemoteBuilderAccessDeniedError {
  return new RemoteBuilderAccessDeniedError({
    capability,
    detail: `${capability} is unavailable in server-enforced remote builder mode.`,
  });
}

export function guardRemoteBuilderEffect<A, E, R>(
  mode: ServerAppMode,
  capability: RemoteBuilderRestrictedCapability,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | RemoteBuilderAccessDeniedError, R> {
  return isRemoteBuilderMode(mode) ? Effect.fail(makeRemoteBuilderDenial(capability)) : effect;
}

export function guardRemoteBuilderStream<A, E, R>(
  mode: ServerAppMode,
  capability: RemoteBuilderRestrictedCapability,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E | RemoteBuilderAccessDeniedError, R> {
  return isRemoteBuilderMode(mode) ? Stream.fail(makeRemoteBuilderDenial(capability)) : stream;
}
