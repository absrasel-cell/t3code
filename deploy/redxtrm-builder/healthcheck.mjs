const port = process.env.T3CODE_PORT || "3000";
const url = `http://127.0.0.1:${port}/api/health`;

try {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(3_000),
  });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (response.status !== 200 || !contentType.startsWith("application/json")) {
    process.exit(1);
  }

  const body = await response.json();
  const keys =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Object.keys(body).toSorted()
      : [];
  const isExpectedBody =
    keys.length === 3 &&
    keys[0] === "mode" &&
    keys[1] === "service" &&
    keys[2] === "status" &&
    body.status === "ok" &&
    body.service === "t3-builder" &&
    body.mode === "redxtrm-remote";

  process.exit(isExpectedBody ? 0 : 1);
} catch {
  process.exit(1);
}
