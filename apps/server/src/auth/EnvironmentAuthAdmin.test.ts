import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";

const makeServerConfigLayer = (
  overrides?: Partial<
    Pick<ServerConfig.ServerConfig["Service"], "browserSessionTtl" | "desktopBootstrapToken">
  >,
) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-auth-control-plane-test-",
      }),
    ),
  );

const makeEnvironmentAuthLayer = (
  overrides?: Partial<
    Pick<ServerConfig.ServerConfig["Service"], "browserSessionTtl" | "desktopBootstrapToken">
  >,
) =>
  EnvironmentAuth.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

it.layer(NodeServices.layer)("EnvironmentAuth administrative operations", (it) => {
  it.effect("creates, lists, and revokes client pairing links", () =>
    Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;

      const created = yield* environmentAuth.createPairingLink({
        scopes: ["orchestration:read"],
        subject: "one-time-token",
        label: "CI phone",
      });
      const listedBeforeRevoke = yield* environmentAuth.listPairingLinks();
      const revoked = yield* environmentAuth.revokePairingLink(created.id);
      const listedAfterRevoke = yield* environmentAuth.listPairingLinks();

      expect(created.scopes).toEqual(["orchestration:read"]);
      expect(created.credential.length).toBeGreaterThan(0);
      expect(listedBeforeRevoke).toHaveLength(1);
      expect(listedBeforeRevoke[0]?.id).toBe(created.id);
      expect(listedBeforeRevoke[0]?.label).toBe("CI phone");
      expect(listedBeforeRevoke[0]?.credential).toBe(created.credential);
      expect(revoked).toBe(true);
      expect(listedAfterRevoke).toHaveLength(0);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("issues bearer access token sessions without exposing raw tokens", () =>
    Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessionCredentials = yield* SessionStore.SessionStore;

      const issued = yield* environmentAuth.issueSession({
        label: "deploy-bot",
      });
      const verified = yield* sessionCredentials.verify(issued.token);
      const listedBeforeRevoke = yield* environmentAuth.listSessions();
      const revoked = yield* environmentAuth.revokeSession(issued.sessionId);
      const listedAfterRevoke = yield* environmentAuth.listSessions();

      expect(issued.method).toBe("bearer-access-token");
      expect(issued.scopes).toEqual([
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
        "relay:read",
        "access:read",
        "access:write",
        "relay:write",
      ]);
      expect(issued.client.deviceType).toBe("bot");
      expect(issued.client.label).toBe("deploy-bot");
      expect(verified.sessionId).toBe(issued.sessionId);
      expect(verified.scopes).toEqual([
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
        "relay:read",
        "access:read",
        "access:write",
        "relay:write",
      ]);
      expect(verified.method).toBe("bearer-access-token");
      expect(listedBeforeRevoke).toHaveLength(1);
      expect(listedBeforeRevoke[0]?.sessionId).toBe(issued.sessionId);
      expect("token" in (listedBeforeRevoke[0] ?? {})).toBe(false);
      expect(revoked).toBe(true);
      expect(listedAfterRevoke).toHaveLength(0);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("exchanges least-privilege pairing links into 24-hour browser sessions", () =>
    Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessionCredentials = yield* SessionStore.SessionStore;
      const pairing = yield* environmentAuth.createPairingLink({
        label: "LLP browser",
        scopes: ["orchestration:read", "orchestration:operate"],
      });

      const browser = yield* environmentAuth.createBrowserSession(pairing.credential, {
        deviceType: "mobile",
      });
      const verified = yield* sessionCredentials.verify(browser.sessionToken);
      const sessions = yield* environmentAuth.listSessions();
      const listed = sessions.find((session) => session.sessionId === verified.sessionId);

      expect(browser.response.scopes).toEqual(["orchestration:read", "orchestration:operate"]);
      expect(verified.scopes).toEqual(["orchestration:read", "orchestration:operate"]);
      expect(
        (listed?.expiresAt.epochMilliseconds ?? 0) - (listed?.issuedAt.epochMilliseconds ?? 0),
      ).toBe(Duration.toMillis(Duration.hours(24)));
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthLayer({
          browserSessionTtl: Duration.hours(24),
        }),
      ),
    ),
  );

  it.effect("surfaces lastConnectedAt through the listed session view", () =>
    Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessionCredentials = yield* SessionStore.SessionStore;

      const issued = yield* environmentAuth.issueSession({
        label: "remote-ipad",
      });
      const beforeConnect = yield* environmentAuth.listSessions();
      yield* sessionCredentials.markConnected(issued.sessionId);
      const afterConnect = yield* environmentAuth.listSessions();

      expect(beforeConnect[0]?.lastConnectedAt).toBeNull();
      expect(afterConnect[0]?.lastConnectedAt).not.toBeNull();
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );
});
