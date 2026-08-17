/**
 * ProviderRegistryLive - Aggregates provider-specific snapshot services.
 *
 * @module ProviderRegistryLive
 */
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelCapabilities,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { Effect, Equal, FileSystem, Layer, Path, PubSub, Ref, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import { ClaudeProviderLive } from "./ClaudeProvider.ts";
import { CodexProviderLive } from "./CodexProvider.ts";
import { CursorProviderLive } from "./CursorProvider.ts";
import { OpenCodeProviderLive } from "./OpenCodeProvider.ts";
import { ClaudeProvider } from "../Services/ClaudeProvider.ts";
import { CodexProvider } from "../Services/CodexProvider.ts";
import { CursorProvider } from "../Services/CursorProvider.ts";
import { OpenCodeProvider } from "../Services/OpenCodeProvider.ts";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry.ts";
import {
  hydrateCachedProvider,
  PROVIDER_CACHE_IDS,
  orderProviderSnapshots,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "../providerStatusCache.ts";
import {
  isRemoteBuilderMode,
  resolveServerAppModeFromEnv,
  type ServerAppMode,
} from "../../remoteBuilderMode.ts";
import { resolveRedClawConfig, type RedClawEnvironment } from "../redclawConfig.ts";

type ProviderSnapshotSource = {
  readonly provider: ProviderKind;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
};

const EMPTY_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

export function buildRedClawProviderSnapshot(
  environment: RedClawEnvironment = process.env,
): ServerProvider {
  const configured = resolveRedClawConfig(environment) !== undefined;
  return {
    provider: "redclaw",
    enabled: configured,
    installed: configured,
    version: null,
    status: configured ? "ready" : "disabled",
    auth: configured
      ? {
          status: "authenticated",
          type: "client-dev-bff",
          label: "Client Dev BFF",
        }
      : { status: "unknown" },
    checkedAt: new Date().toISOString(),
    message: configured
      ? "RedClaw Client Dev BFF is configured."
      : "RedClaw Client Dev BFF is not configured.",
    models: configured
      ? [
          {
            slug: DEFAULT_MODEL_BY_PROVIDER.redclaw,
            name: "Client Dev Orchestrator",
            isCustom: false,
            capabilities: EMPTY_MODEL_CAPABILITIES,
          },
        ]
      : [],
    // Never project local provider discovery data, skills, paths, or commands
    // into the remote builder configuration.
    slashCommands: [],
    skills: [],
  };
}

function makeRedClawProviderSource(environment: RedClawEnvironment): ProviderSnapshotSource {
  const snapshot = () => Effect.sync(() => buildRedClawProviderSnapshot(environment));
  return {
    provider: "redclaw",
    getSnapshot: snapshot(),
    refresh: snapshot(),
    streamChanges: Stream.empty,
  };
}

const loadProviders = (
  providerSources: ReadonlyArray<ProviderSnapshotSource>,
): Effect.Effect<ReadonlyArray<ServerProvider>> =>
  Effect.forEach(providerSources, (providerSource) => providerSource.getSnapshot, {
    concurrency: "unbounded",
  });

const hasModelCapabilities = (model: ServerProvider["models"][number]): boolean =>
  (model.capabilities?.reasoningEffortLevels.length ?? 0) > 0 ||
  model.capabilities?.supportsFastMode === true ||
  model.capabilities?.supportsThinkingToggle === true ||
  (model.capabilities?.contextWindowOptions.length ?? 0) > 0 ||
  (model.capabilities?.promptInjectedEffortLevels.length ?? 0) > 0;

const mergeProviderModels = (
  previousModels: ReadonlyArray<ServerProvider["models"][number]>,
  nextModels: ReadonlyArray<ServerProvider["models"][number]>,
): ReadonlyArray<ServerProvider["models"][number]> => {
  if (nextModels.length === 0 && previousModels.length > 0) {
    return previousModels;
  }

  const previousBySlug = new Map(previousModels.map((model) => [model.slug, model] as const));
  const mergedModels = nextModels.map((model) => {
    const previousModel = previousBySlug.get(model.slug);
    if (!previousModel || hasModelCapabilities(model) || !hasModelCapabilities(previousModel)) {
      return model;
    }
    return {
      ...model,
      capabilities: previousModel.capabilities,
    };
  });
  const nextSlugs = new Set(nextModels.map((model) => model.slug));
  return [...mergedModels, ...previousModels.filter((model) => !nextSlugs.has(model.slug))];
};

export const mergeProviderSnapshot = (
  previousProvider: ServerProvider | undefined,
  nextProvider: ServerProvider,
): ServerProvider =>
  !previousProvider
    ? nextProvider
    : {
        ...nextProvider,
        models: mergeProviderModels(previousProvider.models, nextProvider.models),
      };

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

function makeProviderRegistryLiveBase(options: {
  readonly mode: ServerAppMode;
  readonly environment: RedClawEnvironment;
}) {
  return Layer.effect(
    ProviderRegistry,
    Effect.gen(function* () {
      const codexProvider = yield* Effect.serviceOption(CodexProvider);
      const claudeProvider = yield* Effect.serviceOption(ClaudeProvider);
      const openCodeProvider = yield* Effect.serviceOption(OpenCodeProvider);
      const config = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const cursorProvider = yield* Effect.serviceOption(CursorProvider);

      const providerSources: ReadonlyArray<ProviderSnapshotSource> = isRemoteBuilderMode(
        options.mode,
      )
        ? [makeRedClawProviderSource(options.environment)]
        : [
            ...(codexProvider._tag === "Some"
              ? [
                  {
                    provider: "codex" as const,
                    getSnapshot: codexProvider.value.getSnapshot,
                    refresh: codexProvider.value.refresh,
                    streamChanges: codexProvider.value.streamChanges,
                  },
                ]
              : []),
            ...(claudeProvider._tag === "Some"
              ? [
                  {
                    provider: "claudeAgent" as const,
                    getSnapshot: claudeProvider.value.getSnapshot,
                    refresh: claudeProvider.value.refresh,
                    streamChanges: claudeProvider.value.streamChanges,
                  },
                ]
              : []),
            ...(openCodeProvider._tag === "Some"
              ? [
                  {
                    provider: "opencode" as const,
                    getSnapshot: openCodeProvider.value.getSnapshot,
                    refresh: openCodeProvider.value.refresh,
                    streamChanges: openCodeProvider.value.streamChanges,
                  },
                ]
              : []),
            ...(cursorProvider._tag === "Some"
              ? [
                  {
                    provider: "cursor" as const,
                    getSnapshot: cursorProvider.value.getSnapshot,
                    refresh: cursorProvider.value.refresh,
                    streamChanges: cursorProvider.value.streamChanges,
                  },
                ]
              : []),
          ];
      const activeProviders = isRemoteBuilderMode(options.mode) ? [] : PROVIDER_CACHE_IDS;
      const changesPubSub = yield* Effect.acquireRelease(
        PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
        PubSub.shutdown,
      );
      const fallbackProviders = yield* loadProviders(providerSources);
      const cachePathByProvider = new Map<ProviderKind, string>(
        activeProviders.map(
          (provider) =>
            [
              provider,
              resolveProviderStatusCachePath({
                cacheDir: config.providerStatusCacheDir,
                provider,
              }),
            ] as const,
        ),
      );
      const fallbackByProvider = new Map(
        fallbackProviders.map((provider) => [provider.provider, provider] as const),
      );

      const cachedProviders = yield* Effect.forEach(
        activeProviders,
        (provider) => {
          const filePath = cachePathByProvider.get(provider)!;
          const fallbackProvider = fallbackByProvider.get(provider)!;
          return readProviderStatusCache(filePath).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.map((cachedProvider) =>
              cachedProvider === undefined
                ? undefined
                : hydrateCachedProvider({
                    cachedProvider,
                    fallbackProvider,
                  }),
            ),
          );
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((providers) =>
          orderProviderSnapshots(
            providers.filter((provider): provider is ServerProvider => provider !== undefined),
          ),
        ),
      );
      const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(cachedProviders);

      const persistProvider = (provider: ServerProvider) => {
        const filePath = cachePathByProvider.get(provider.provider);
        if (!filePath) return Effect.void;
        return writeProviderStatusCache({
          filePath,
          provider,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.tapError(Effect.logError),
          Effect.ignore,
        );
      };

      const upsertProviders = Effect.fn("upsertProviders")(function* (
        nextProviders: ReadonlyArray<ServerProvider>,
        options?: {
          readonly publish?: boolean;
        },
      ) {
        const [previousProviders, providers] = yield* Ref.modify(
          providersRef,
          (previousProviders) => {
            const mergedProviders = new Map(
              previousProviders.map((provider) => [provider.provider, provider] as const),
            );

            for (const provider of nextProviders) {
              mergedProviders.set(
                provider.provider,
                mergeProviderSnapshot(mergedProviders.get(provider.provider), provider),
              );
            }

            const providers = orderProviderSnapshots([...mergedProviders.values()]);
            return [[previousProviders, providers] as const, providers];
          },
        );

        if (haveProvidersChanged(previousProviders, providers)) {
          yield* Effect.forEach(nextProviders, persistProvider, {
            concurrency: "unbounded",
            discard: true,
          });
          if (options?.publish !== false) {
            yield* PubSub.publish(changesPubSub, providers);
          }
        }

        return providers;
      });

      const syncProvider = Effect.fn("syncProvider")(function* (
        provider: ServerProvider,
        options?: {
          readonly publish?: boolean;
        },
      ) {
        return yield* upsertProviders([provider], options);
      });

      const refresh = Effect.fn("refresh")(function* (provider?: ProviderKind) {
        if (provider) {
          const providerSource = providerSources.find(
            (candidate) => candidate.provider === provider,
          );
          if (!providerSource) {
            return yield* Ref.get(providersRef);
          }
          return yield* providerSource.refresh.pipe(
            Effect.flatMap((nextProvider) => syncProvider(nextProvider)),
          );
        }

        return yield* Effect.forEach(
          providerSources,
          (providerSource) => providerSource.refresh.pipe(Effect.flatMap(syncProvider)),
          {
            concurrency: "unbounded",
            discard: true,
          },
        ).pipe(Effect.andThen(Ref.get(providersRef)));
      });

      yield* Effect.forEach(
        providerSources,
        (providerSource) =>
          Stream.runForEach(providerSource.streamChanges, (provider) =>
            syncProvider(provider),
          ).pipe(Effect.forkScoped),
        {
          concurrency: "unbounded",
          discard: true,
        },
      );
      yield* loadProviders(providerSources).pipe(
        Effect.flatMap((providers) => upsertProviders(providers, { publish: false })),
      );

      return {
        getProviders: Ref.get(providersRef),
        refresh: (provider?: ProviderKind) =>
          refresh(provider).pipe(
            Effect.tapError(Effect.logError),
            Effect.orElseSucceed(() => [] as ReadonlyArray<ServerProvider>),
          ),
        get streamChanges() {
          return Stream.fromPubSub(changesPubSub);
        },
      } satisfies ProviderRegistryShape;
    }),
  );
}

export function makeProviderRegistryLive(options?: {
  readonly mode?: ServerAppMode;
  readonly environment?: RedClawEnvironment;
}) {
  const mode = options?.mode ?? resolveServerAppModeFromEnv();
  const base = makeProviderRegistryLiveBase({
    mode,
    environment: options?.environment ?? process.env,
  });
  return isRemoteBuilderMode(mode)
    ? base
    : base.pipe(
        Layer.provideMerge(CursorProviderLive),
        Layer.provideMerge(CodexProviderLive),
        Layer.provideMerge(ClaudeProviderLive),
        Layer.provideMerge(OpenCodeProviderLive),
      );
}

export const ProviderRegistryLive = makeProviderRegistryLive();
