#!/usr/bin/env bash
# Fetches the Playdate SDK for Linux, checks it, unpacks it, and prints the path to give
# PLAYDATE_SDK_PATH. The SDK is Panic's and is never committed or copied into this repository.
#
#   bash scripts/playdate-sdk.sh [folder]        folder defaults to ~/.cache/sprout/playdate-sdk
#   export PLAYDATE_SDK_PATH="$(bash scripts/playdate-sdk.sh)"
#
# The download page publishes no checksum, so this pins the version, the size in bytes and the
# SHA-256 of the 3.1.2 tarball as downloaded on 2026-10-10. A tarball that differs is refused:
# if Panic has re-issued 3.1.2 (or you want another version), download it by hand, read its
# SDK_LICENSE.md, and update the three lines below.
#
# Nothing in the unpacked SDK is run here. The build runs its `pdc` and reads its headers and
# CMake files by path, and the unpacked tree is treated as data.
set -euo pipefail

VERSION=3.1.2
URL="https://download.panic.com/playdate_sdk/Linux/PlaydateSDK-${VERSION}.tar.gz"
SIZE=33810967
SHA256=7e3d912611e82f79007afd2a3a9e68a19c8bfc7025b5f761805f21368470d793

root="${1:-${HOME}/.cache/sprout/playdate-sdk}"
sdk="${root}/PlaydateSDK-${VERSION}"

if [ -f "${sdk}/VERSION.txt" ] && [ "$(cat "${sdk}/VERSION.txt")" = "${VERSION}" ]; then
  echo "${sdk}"
  exit 0
fi

mkdir -p "${root}"
work="$(mktemp -d "${root}/download.XXXXXX")"
trap 'rm -rf "${work}"' EXIT

echo "Fetching the Playdate SDK ${VERSION} (${SIZE} bytes) from ${URL}" >&2
curl -sSL --fail -o "${work}/sdk.tar.gz" "${URL}"

got_size="$(wc -c < "${work}/sdk.tar.gz" | tr -d ' ')"
if [ "${got_size}" != "${SIZE}" ]; then
  echo "scripts/playdate-sdk.sh: the download is ${got_size} bytes, not the ${SIZE} recorded for ${VERSION}." >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  got_sha="$(sha256sum "${work}/sdk.tar.gz" | cut -d' ' -f1)"
else
  got_sha="$(shasum -a 256 "${work}/sdk.tar.gz" | cut -d' ' -f1)"
fi
if [ "${got_sha}" != "${SHA256}" ]; then
  echo "scripts/playdate-sdk.sh: the download's SHA-256 is ${got_sha}, not the ${SHA256} recorded for ${VERSION}." >&2
  exit 1
fi

mkdir "${work}/unpacked"
tar -xzf "${work}/sdk.tar.gz" -C "${work}/unpacked"
if [ ! -f "${work}/unpacked/PlaydateSDK-${VERSION}/VERSION.txt" ]; then
  echo "scripts/playdate-sdk.sh: the tarball does not unpack to PlaydateSDK-${VERSION}." >&2
  exit 1
fi
rm -rf "${sdk}"
mv "${work}/unpacked/PlaydateSDK-${VERSION}" "${sdk}"
echo "${sdk}"
