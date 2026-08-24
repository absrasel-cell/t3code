#!/usr/bin/env bash
set -euo pipefail

readonly web_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly icon_version="20260824-2"

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "${expected}" "${file}" || {
    printf 'missing expected branding reference in %s: %s\n' "${file}" "${expected}" >&2
    return 1
  }
}

assert_contains "${web_root}/index.html" \
  "href=\"/r3xcode-favicon.ico?v=${icon_version}\""
assert_contains "${web_root}/index.html" \
  "href=\"/r3xcode-apple-touch-icon.png?v=${icon_version}\""
assert_contains "${web_root}/index.html" \
  "src=\"/r3xcode-apple-touch-icon.png?v=${icon_version}\""
assert_contains "${web_root}/src/components/SplashScreen.tsx" \
  "src=\"/r3xcode-apple-touch-icon.png?v=${icon_version}\""
assert_contains "${web_root}/public/r3xcode-manifest.webmanifest" \
  '"src": "/r3xcode-favicon-32x32.png"'
assert_contains "${web_root}/public/r3xcode-manifest.webmanifest" \
  '"src": "/r3xcode-apple-touch-icon.png"'

cmp -- "${web_root}/public/favicon.ico" "${web_root}/public/r3xcode-favicon.ico"
cmp -- "${web_root}/public/favicon-16x16.png" "${web_root}/public/r3xcode-favicon-16x16.png"
cmp -- "${web_root}/public/favicon-32x32.png" "${web_root}/public/r3xcode-favicon-32x32.png"
cmp -- "${web_root}/public/apple-touch-icon.png" \
  "${web_root}/public/r3xcode-apple-touch-icon.png"

printf 'r3xcode_branding_assets=ok\n'
