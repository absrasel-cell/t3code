import { type BuilderSessionScope, ProjectId } from "@t3tools/contracts";
import { createHash } from "node:crypto";

export function sameBuilderAuthority(
  left: BuilderSessionScope,
  right: BuilderSessionScope,
): boolean {
  return (
    left.v === right.v &&
    left.subject === right.subject &&
    left.workspaceId === right.workspaceId &&
    left.tenantKey === right.tenantKey &&
    left.projectKey === right.projectKey &&
    left.role === right.role
  );
}

/** Tenant-keyed opaque T3 project id; raw dashboard ids never become global projection keys. */
export function builderProjectId(scope: BuilderSessionScope): ProjectId {
  const digest = createHash("sha256")
    .update(scope.tenantKey, "utf8")
    .update("\0", "utf8")
    .update(scope.projectKey, "utf8")
    .update("\0", "utf8")
    .update(scope.subject, "utf8")
    .digest("hex")
    .slice(0, 40);
  return ProjectId.make(`redxtrm-${digest}`);
}
