#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly fixture_root="$(mktemp -d)"
trap 'rm -rf -- "${fixture_root}"' EXIT

make_dist() {
  local name="$1"
  local bundle="$2"
  local dist="${fixture_root}/${name}"

  mkdir -p -- "${dist}/assets"
  printf '<script type="module" src="/assets/index-test.js"></script>\n' >"${dist}/index.html"
  printf '%s\n' "${bundle}" >"${dist}/assets/index-test.js"
}

make_dist passing 'const profile="llp-full"; const label="R3xCode";'
"${script_dir}/verify-r3xcode-branding.sh" \
  --dist "${fixture_root}/passing" \
  --profile llp-full >/dev/null

make_dist missing_profile 'const label="R3xCode";'
if "${script_dir}/verify-r3xcode-branding.sh" \
  --dist "${fixture_root}/missing_profile" \
  --profile llp-full >/dev/null 2>&1; then
  printf 'expected compiled branding verification to reject a missing profile\n' >&2
  exit 1
fi

make_dist stale_label \
  'const profile="llp-full"; const label="R3xCode"; const stale="redXtrm";'
if "${script_dir}/verify-r3xcode-branding.sh" \
  --dist "${fixture_root}/stale_label" \
  --profile llp-full >/dev/null 2>&1; then
  printf 'expected compiled branding verification to reject the stale label\n' >&2
  exit 1
fi

printf 'r3xcode_branding_compiled_test=ok\n'
