import {
  type AuthBearerBootstrapResult,
  AuthBootstrapInput,
  AuthCreatePairingCredentialInput,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  type AuthWebSocketTokenResult,
  BuilderHandoffExchangeInput,
  type BuilderHandoffExchangeResult,
  type BuilderSessionScope,
} from "@t3tools/contracts";
import { DateTime, Duration, Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "./Services/ServerAuth.ts";
import { SessionCredentialService } from "./Services/SessionCredentialService.ts";
import { deriveAuthClientMetadata } from "./utils.ts";
import { BuilderHandoffService, BuilderHandoffError } from "./Services/BuilderHandoff.ts";
import {
  isTrustedBuilderRequestOrigin,
  resolveBuilderHandoffConfig,
} from "./builderHandoffConfig.ts";
import { isRemoteBuilderMode, resolveServerAppModeFromEnv } from "../remoteBuilderMode.ts";

const BUILDER_SESSION_TTL = Duration.hours(12);
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  Pragma: "no-cache",
} as const;

const genericPairingAllowed = Effect.suspend(() =>
  isRemoteBuilderMode(resolveServerAppModeFromEnv())
    ? Effect.fail(
        new AuthError({
          message: "Generic pairing is unavailable in dashboard-managed builder mode.",
          status: 403,
        }),
      )
    : Effect.void,
);

export const respondToAuthError = (error: AuthError) =>
  Effect.gen(function* () {
    if ((error.status ?? 500) >= 500) {
      yield* Effect.logError("auth route failed", {
        message: error.message,
        cause: error.cause,
      });
    }
    return HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
      },
      { status: error.status ?? 500, headers: PRIVATE_RESPONSE_HEADERS },
    );
  });

export const authSessionRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/session",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* ServerAuth;
    const session = yield* serverAuth.getSessionState(request);
    return HttpServerResponse.jsonUnsafe(session, { status: 200 });
  }),
);

const PairingCredentialRequestHeaders = Schema.Struct({
  "content-length": Schema.optionalKey(Schema.String),
  "content-type": Schema.optionalKey(Schema.String),
  "transfer-encoding": Schema.optionalKey(Schema.String),
});

function hasRequestBody(headers: typeof PairingCredentialRequestHeaders.Type) {
  const contentLengthHeader = headers["content-length"];
  if (typeof contentLengthHeader === "string") {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength)) {
      return contentLength > 0;
    }
  }
  return typeof headers["transfer-encoding"] === "string";
}

export const authBootstrapRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/bootstrap",
  Effect.gen(function* () {
    yield* genericPairingAllowed;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* ServerAuth;
    const sessions = yield* SessionCredentialService;
    const payload = yield* HttpServerRequest.schemaBodyJson(AuthBootstrapInput).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Invalid bootstrap payload.",
            status: 400,
            cause,
          }),
      ),
    );
    const result = yield* serverAuth.exchangeBootstrapCredential(
      payload.credential,
      deriveAuthClientMetadata({ request }),
    );

    return yield* HttpServerResponse.jsonUnsafe(result.response, { status: 200 }).pipe(
      HttpServerResponse.setCookie(sessions.cookieName, result.sessionToken, {
        expires: DateTime.toDate(result.response.expiresAt),
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      }),
    );
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

export const authBearerBootstrapRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/bootstrap/bearer",
  Effect.gen(function* () {
    yield* genericPairingAllowed;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* ServerAuth;
    const payload = yield* HttpServerRequest.schemaBodyJson(AuthBootstrapInput).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Invalid bootstrap payload.",
            status: 400,
            cause,
          }),
      ),
    );
    const result = yield* serverAuth.exchangeBootstrapCredentialForBearerSession(
      payload.credential,
      deriveAuthClientMetadata({ request }),
    );
    return HttpServerResponse.jsonUnsafe(result satisfies AuthBearerBootstrapResult, {
      status: 200,
    });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

export const authWebSocketTokenRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/ws-token",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (isRemoteBuilderMode(resolveServerAppModeFromEnv())) {
      const config = resolveBuilderHandoffConfig();
      if (!config || request.headers.origin !== config.audience) {
        return yield* new AuthError({ message: "Untrusted request origin.", status: 403 });
      }
    }
    const serverAuth = yield* ServerAuth;
    const session = yield* serverAuth.authenticateHttpRequest(request);
    const result = yield* serverAuth.issueWebSocketToken(session);
    return HttpServerResponse.jsonUnsafe(result satisfies AuthWebSocketTokenResult, {
      status: 200,
    });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

export const authPairingCredentialRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/pairing-token",
  Effect.gen(function* () {
    yield* genericPairingAllowed;
    const serverAuth = yield* ServerAuth;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* serverAuth.authenticateHttpRequest(request);
    if (session.role !== "owner") {
      return yield* new AuthError({
        message: "Only owner sessions can create pairing credentials.",
        status: 403,
      });
    }
    const headers = yield* HttpServerRequest.schemaHeaders(PairingCredentialRequestHeaders).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Invalid pairing credential request headers.",
            status: 400,
            cause,
          }),
      ),
    );
    const payload = hasRequestBody(headers)
      ? yield* HttpServerRequest.schemaBodyJson(AuthCreatePairingCredentialInput).pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({
                message: "Invalid pairing credential payload.",
                status: 400,
                cause,
              }),
          ),
        )
      : {};
    const result = yield* serverAuth.issuePairingCredential(payload);
    return HttpServerResponse.jsonUnsafe(result, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

const authenticateOwnerSession = Effect.gen(function* () {
  yield* genericPairingAllowed;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new AuthError({
      message: "Only owner sessions can manage network access.",
      status: 403,
    });
  }
  return { serverAuth, session } as const;
});

export const authPairingLinksRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/pairing-links",
  Effect.gen(function* () {
    const { serverAuth } = yield* authenticateOwnerSession;
    const pairingLinks = yield* serverAuth.listPairingLinks();
    return HttpServerResponse.jsonUnsafe(pairingLinks, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

function mapBuilderHandoffError(error: BuilderHandoffError): AuthError {
  if (error.reason === "already_used") {
    return new AuthError({ message: "Builder handoff ticket was already used.", status: 409 });
  }
  if (error.reason === "unavailable") {
    return new AuthError({ message: "Builder handoff is temporarily unavailable.", status: 503 });
  }
  return new AuthError({ message: "Invalid or expired builder handoff ticket.", status: 401 });
}

const BuilderHandoffRequestHeaders = Schema.Struct({
  origin: Schema.optionalKey(Schema.String),
  "content-type": Schema.optionalKey(Schema.String),
});

export const builderHandoffRouteLayer = HttpRouter.add(
  "POST",
  "/pair",
  Effect.gen(function* () {
    if (!isRemoteBuilderMode(resolveServerAppModeFromEnv())) {
      return yield* new AuthError({ message: "Builder handoff is unavailable.", status: 403 });
    }
    const config = resolveBuilderHandoffConfig();
    if (!config) {
      return yield* new AuthError({
        message: "Builder handoff is not configured.",
        status: 503,
      });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = yield* HttpServerRequest.schemaHeaders(BuilderHandoffRequestHeaders).pipe(
      Effect.mapError(
        (cause) => new AuthError({ message: "Invalid handoff headers.", status: 400, cause }),
      ),
    );
    if (!isTrustedBuilderRequestOrigin(headers.origin, config)) {
      return yield* new AuthError({ message: "Untrusted handoff origin.", status: 403 });
    }

    const contentType = headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    const payload =
      contentType === "application/x-www-form-urlencoded"
        ? yield* HttpServerRequest.schemaBodyUrlParams(BuilderHandoffExchangeInput).pipe(
            Effect.mapError(
              (cause) => new AuthError({ message: "Invalid handoff payload.", status: 400, cause }),
            ),
          )
        : contentType === "application/json"
          ? yield* HttpServerRequest.schemaBodyJson(BuilderHandoffExchangeInput).pipe(
              Effect.mapError(
                (cause) =>
                  new AuthError({ message: "Invalid handoff payload.", status: 400, cause }),
              ),
            )
          : yield* new AuthError({
              message: "Unsupported handoff content type.",
              status: 415,
            });

    const handoff = yield* BuilderHandoffService;
    const claims = yield* handoff
      .exchange(payload.ticket)
      .pipe(Effect.mapError(mapBuilderHandoffError));
    const builderScope: BuilderSessionScope = {
      v: claims.v,
      handoffJti: claims.jti,
      subject: claims.sub,
      workspaceId: claims.workspaceId,
      tenantKey: claims.tenantKey,
      projectKey: claims.projectKey,
      role: claims.role,
    };
    const sessions = yield* SessionCredentialService;
    const issued = yield* sessions
      .issue({
        ttl: BUILDER_SESSION_TTL,
        method: "browser-session-cookie",
        subject: claims.sub,
        role: "client",
        builderScope,
        client: deriveAuthClientMetadata({ request, label: "RedXTRM dashboard handoff" }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({ message: "Failed to issue builder session.", status: 503, cause }),
        ),
      );

    const result: BuilderHandoffExchangeResult = {
      authenticated: true,
      role: "client",
      sessionMethod: "browser-session-cookie",
      expiresAt: DateTime.toUtc(issued.expiresAt),
      builderScope,
    };
    const acceptsJson = request.headers.accept?.includes("application/json") ?? false;
    const response = acceptsJson
      ? HttpServerResponse.jsonUnsafe(result, { status: 200, headers: PRIVATE_RESPONSE_HEADERS })
      : HttpServerResponse.redirect("/", { status: 303, headers: PRIVATE_RESPONSE_HEADERS });
    return yield* response.pipe(
      HttpServerResponse.setCookie(sessions.cookieName, issued.token, {
        expires: DateTime.toDate(issued.expiresAt),
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        secure: config.audience.startsWith("https://"),
      }),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const authPairingLinksRevokeRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/pairing-links/revoke",
  Effect.gen(function* () {
    const { serverAuth } = yield* authenticateOwnerSession;
    const payload = yield* HttpServerRequest.schemaBodyJson(AuthRevokePairingLinkInput).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Invalid revoke pairing link payload.",
            status: 400,
            cause,
          }),
      ),
    );
    const revoked = yield* serverAuth.revokePairingLink(payload.id);
    return HttpServerResponse.jsonUnsafe({ revoked }, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

export const authClientsRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/clients",
  Effect.gen(function* () {
    const { serverAuth, session } = yield* authenticateOwnerSession;
    const clients = yield* serverAuth.listClientSessions(session.sessionId);
    return HttpServerResponse.jsonUnsafe(clients, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

export const authClientsRevokeRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/clients/revoke",
  Effect.gen(function* () {
    const { serverAuth, session } = yield* authenticateOwnerSession;
    const payload = yield* HttpServerRequest.schemaBodyJson(AuthRevokeClientSessionInput).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Invalid revoke client payload.",
            status: 400,
            cause,
          }),
      ),
    );
    const revoked = yield* serverAuth.revokeClientSession(session.sessionId, payload.sessionId);
    return HttpServerResponse.jsonUnsafe({ revoked }, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

export const authClientsRevokeOthersRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/clients/revoke-others",
  Effect.gen(function* () {
    const { serverAuth, session } = yield* authenticateOwnerSession;
    const revokedCount = yield* serverAuth.revokeOtherClientSessions(session.sessionId);
    return HttpServerResponse.jsonUnsafe({ revokedCount }, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);
