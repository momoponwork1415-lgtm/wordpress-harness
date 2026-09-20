#!/usr/bin/env bash

set -euo pipefail
umask 077

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold)
  DIM=$(tput dim)
  RESET=$(tput sgr0)
  BLUE=$(tput setaf 4)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  RED=$(tput setaf 1)
else
  BOLD=""
  DIM=""
  RESET=""
  BLUE=""
  GREEN=""
  YELLOW=""
  RED=""
fi

say() { printf '  %s\n' "$1"; }
pass() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }

fail() {
  printf '  %s✗ %s%s\n' "$RED" "$1" "$RESET" >&2
  exit 1
}

banner() {
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  setup後にURL・認証情報・手順を表示 · Ctrl-CでLabを破棄%s\n\n' "$DIM" "$RESET"
}

cleanup() {
  if declare -F cleanup_finding_resources >/dev/null 2>&1; then
    cleanup_finding_resources
  fi
}

on_error() {
  local exit_code=$?
  cleanup
  printf '\n%sLab setupに失敗しました。%s\n' "$YELLOW" "$RESET" >&2
  exit "$exit_code"
}

on_signal() {
  cleanup
  exit 130
}

trap on_error ERR
trap on_signal INT TERM
trap cleanup EXIT

# FINDING-SPECIFIC SETUP AND GUIDE START HERE. Replace everything below this line.
banner "Unauthored WordPress Disposable Lab"
fail "This template must be bound to an exact Finding before it is run."
