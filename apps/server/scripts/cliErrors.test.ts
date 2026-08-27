import { assert, describe, it } from "@effect/vitest";

import {
  ServerCliBuildAssetMissingError,
  ServerCliCommandExitError,
  ServerCliDeploymentProfileMismatchError,
} from "./cliErrors.ts";

describe("server CLI errors", () => {
  it("preserves failed command context without changing its message", () => {
    const error = new ServerCliCommandExitError({
      command: "vp",
      args: ["pm", "publish"],
      cwd: "/repo",
      exitCode: 17,
    });

    assert.equal(error._tag, "ServerCliCommandExitError");
    assert.equal(error.command, "vp");
    assert.deepEqual(error.args, ["pm", "publish"]);
    assert.equal(error.cwd, "/repo");
    assert.equal(error.exitCode, 17);
    assert.equal(error.message, "Command exited with non-zero exit code (17)");
  });

  it("preserves a representative missing asset path", () => {
    const error = new ServerCliBuildAssetMissingError({ assetPath: "/repo/server.mjs" });

    assert.equal(error.assetPath, "/repo/server.mjs");
    assert.equal(
      error.message,
      "Missing build asset: /repo/server.mjs. Run the build subcommand first.",
    );
  });

  it("reports both deployment profiles when an LLP build is inconsistent", () => {
    const error = new ServerCliDeploymentProfileMismatchError({
      serverProfile: "llp-full",
      webProfile: null,
    });

    assert.equal(
      error.message,
      "Protected LLP builds require matching browser and server profiles. " +
        "Received T3CODE_DEPLOYMENT_PROFILE=llp-full and " +
        "VITE_T3CODE_DEPLOYMENT_PROFILE=<unset>.",
    );
  });
});
