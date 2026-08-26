#!/usr/bin/env bash
set -euo pipefail

readonly web_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly icon_version="20260824-2"

dist_root=""
expected_profile=""

while (($# > 0)); do
  case "$1" in
    --dist)
      [[ $# -ge 2 ]] || {
        printf 'missing value for --dist\n' >&2
        exit 2
      }
      dist_root="$2"
      shift 2
      ;;
    --profile)
      [[ $# -ge 2 ]] || {
        printf 'missing value for --profile\n' >&2
        exit 2
      }
      expected_profile="$2"
      shift 2
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "${dist_root}" || -n "${expected_profile}" ]]; then
  [[ -n "${dist_root}" && -n "${expected_profile}" ]] || {
    printf '--dist and --profile must be provided together\n' >&2
    exit 2
  }
fi

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

if [[ -n "${dist_root}" ]]; then
  readonly dist_index="${dist_root}/index.html"
  [[ -f "${dist_index}" ]] || {
    printf 'compiled web index is missing: %s\n' "${dist_index}" >&2
    exit 1
  }

  asset_ref="$({
    grep -oE 'src="[^"]*index-[^"]*\.js([?][^"]*)?"' "${dist_index}" || true
  } | head -n 1 | sed -E 's/^src="([^"]+)"$/\1/; s/[?].*$//')"
  [[ -n "${asset_ref}" ]] || {
    printf 'compiled web entry asset was not found in %s\n' "${dist_index}" >&2
    exit 1
  }

  asset_ref="${asset_ref#/}"
  asset_ref="${asset_ref#./}"
  readonly compiled_asset="${dist_root}/${asset_ref}"
  [[ -f "${compiled_asset}" ]] || {
    printf 'compiled web entry asset is missing: %s\n' "${compiled_asset}" >&2
    exit 1
  }

  assert_contains "${compiled_asset}" "${expected_profile}"
  assert_contains "${compiled_asset}" 'R3xCode'
  if grep -Fq -- 'redXtrm' "${compiled_asset}"; then
    printf 'stale branding reference in %s: redXtrm\n' "${compiled_asset}" >&2
    exit 1
  fi

  printf 'r3xcode_branding_compiled=ok profile=%s asset=%s\n' \
    "${expected_profile}" "${asset_ref}"
fi
