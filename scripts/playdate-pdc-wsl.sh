#!/usr/bin/env bash
# pdc for a Linux where the SDK's own cannot run. The Linux SDK 3.1.2's pdc (and its Simulator)
# need glibc 2.38 and GLIBCXX_3.4.32; Debian 12, the WSL2 default, has glibc 2.36. The Windows
# SDK's pdc.exe runs from WSL over \\wsl.localhost\ paths, so this forwards every call to it,
# translating each path it is given. Install it over the SDK's, keeping the original beside it:
#
#   mv "$PLAYDATE_SDK_PATH/bin/pdc" "$PLAYDATE_SDK_PATH/bin/pdc.linux"
#   cp scripts/playdate-pdc-wsl.sh "$PLAYDATE_SDK_PATH/bin/pdc"
#
# PLAYDATE_WINDOWS_SDK names the Windows SDK (its bin/pdc.exe); unset, the first
# /mnt/c/Users/*/Documents/PlaydateSDK is taken. Nothing else of the Linux SDK is affected: the
# build reads its headers and CMake files, and only pdc is replaced.
set -euo pipefail

win_sdk="${PLAYDATE_WINDOWS_SDK:-}"
if [ -z "${win_sdk}" ]; then
  for candidate in /mnt/c/Users/*/Documents/PlaydateSDK; do
    if [ -x "${candidate}/bin/pdc.exe" ]; then win_sdk="${candidate}"; break; fi
  done
fi
if [ -z "${win_sdk}" ] || [ ! -x "${win_sdk}/bin/pdc.exe" ]; then
  echo "playdate-pdc-wsl.sh: no Windows Playdate SDK found; set PLAYDATE_WINDOWS_SDK to its folder." >&2
  exit 1
fi

# A path for pdc.exe: the folder resolved on this side (it exists for an input, and for an
# output's parent), the last name kept, joined with a backslash.
topath() {
  local dir base
  dir="$(cd "$(dirname "$1")" 2>/dev/null && pwd)" || { printf '%s' "$1"; return; }
  base="$(basename "$1")"
  printf '%s\\%s' "$(wslpath -w "${dir}")" "${base}"
}

args=()
want_sdk=0
for arg in "$@"; do
  if [ "${want_sdk}" = 1 ]; then
    args+=("$(wslpath -w "${win_sdk}")")
    want_sdk=0
    continue
  fi
  case "${arg}" in
    -sdkpath) args+=("${arg}"); want_sdk=1 ;;
    -*) args+=("${arg}") ;;
    *) args+=("$(topath "${arg}")") ;;
  esac
done
exec "${win_sdk}/bin/pdc.exe" "${args[@]}"
