#!/bin/sh
# The tenant console redirects /platform/* to the platform origin. Without this value the
# generated nginx config would redirect to a relative path (and loop on the same host), so fail
# fast at container startup instead.
set -eu

if [ -z "${PLATFORM_CONSOLE_URL:-}" ]; then
  echo "PLATFORM_CONSOLE_URL is required for the tenant console image" >&2
  exit 1
fi

case "$PLATFORM_CONSOLE_URL" in
  */)
    echo "PLATFORM_CONSOLE_URL must not end with a slash" >&2
    exit 1
    ;;
esac
