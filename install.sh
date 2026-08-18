#!/bin/sh
#
# Installs the `slide` CLI from a GitHub release.
#
#   curl -fsSL https://pridont.github.io/slide/install.sh | sh
#
# It downloads the npm tarball attached to a release (the latest, unless
# SLIDE_VERSION says otherwise) and installs it globally with npm. npm is what
# resolves the runtime dependencies, so there is no vendored node_modules to go
# stale and nothing platform-specific to pick.
#
# Nothing here touches api.github.com. The API allows 60 unauthenticated calls
# an hour *per IP address*, which is a shared office or a VPN exit answering
# 403 to everyone behind it. github.com/<repo>/releases/... is a plain redirect
# to the asset with no such limit, and the release workflow attaches a stable
# `slide.tgz` filename so the latest one has a URL that can be written down.
#
# Everything lives in functions and runs from main() at the bottom, so a
# truncated download cannot execute half an installer.
#
set -eu

REPO="${SLIDE_REPO:-pridont/slide}"
VERSION="${SLIDE_VERSION:-latest}"
RELEASES="https://github.com/${REPO}/releases"
ASSET="slide.tgz"
DOCS="https://pridont.github.io/slide/"
NODE_MINIMUM=20

WORK=""
AUTH=""

cleanup() {
  if [ -n "$WORK" ]; then
    rm -rf "$WORK"
  fi
}

log() { printf '  %s\n' "$1"; }

die() {
  printf '\nslide: %s\n\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
slide installer

  curl -fsSL https://pridont.github.io/slide/install.sh | sh

Environment:
  SLIDE_VERSION   a release tag, e.g. v0.2.0 (default: the latest release)
  SLIDE_REPO      owner/name to install from (default: pridont/slide)
  GITHUB_TOKEN    sent with the download, for a private repository
EOF
}

# ---- Fetching ---------------------------------------------------------------

# curl and wget want the auth header spelled differently, and neither can take
# it as one unquoted word, so each downloader gets its own pair of functions.
setup_downloader() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    AUTH="Authorization: Bearer ${GITHUB_TOKEN}"
  fi

  if command -v curl >/dev/null 2>&1; then
    fetch() {
      if [ -n "$AUTH" ]; then curl -fsSL -H "$AUTH" "$1"; else curl -fsSL "$1"; fi
    }
    download() {
      if [ -n "$AUTH" ]; then curl -fsSL -H "$AUTH" -o "$2" "$1"; else curl -fsSL -o "$2" "$1"; fi
    }
  elif command -v wget >/dev/null 2>&1; then
    fetch() {
      if [ -n "$AUTH" ]; then wget -qO- --header="$AUTH" "$1"; else wget -qO- "$1"; fi
    }
    download() {
      if [ -n "$AUTH" ]; then wget -qO "$2" --header="$AUTH" "$1"; else wget -qO "$2" "$1"; fi
    }
  else
    die "needs curl or wget to download a release."
  fi
}

# ---- Checks -----------------------------------------------------------------

check_node() {
  command -v node >/dev/null 2>&1 || die "needs Node.js ${NODE_MINIMUM} or newer — https://nodejs.org"
  command -v npm >/dev/null 2>&1 || die "needs npm, which ships with Node.js — https://nodejs.org"

  major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
  if [ "$major" -lt "$NODE_MINIMUM" ]; then
    die "needs Node.js ${NODE_MINIMUM} or newer; this is $(node -v)."
  fi
}

# ---- The release ------------------------------------------------------------

# The URL the tarball is downloaded from. Both forms are redirects github.com
# serves without authentication and without a rate limit.
asset_url() {
  if [ "$VERSION" = "latest" ]; then
    printf '%s/latest/download/%s\n' "$RELEASES" "$ASSET"
  else
    printf '%s/download/%s/%s\n' "$RELEASES" "$VERSION" "$ASSET"
  fi
}

# Whether a URL answers at all. Used only to say which of two things went
# wrong, so a failure here is just a less specific message.
exists() { fetch "$1" >/dev/null 2>&1; }

# Called when the download failed. A missing release and a release with no
# tarball attached are the same 404 to the downloader, so the release page
# itself is what tells them apart.
explain_failure() {
  if [ "$VERSION" = "latest" ]; then
    if exists "${RELEASES}/latest"; then
      die "the latest release of ${REPO} has no ${ASSET} attached to it.

Every release is built by the repository's own workflow, which attaches one.
A release made by hand will not have it. Pick another:

  ${RELEASES}"
    fi
    die "${REPO} has no published release yet — or github.com is unreachable.

Install from source instead:

  git clone https://github.com/${REPO}.git
  cd slide && npm install && npm run build && npm install -g ."
  fi

  if exists "${RELEASES}/tag/${VERSION}"; then
    die "release ${VERSION} of ${REPO} has no ${ASSET} attached to it.

Every release is built by the repository's own workflow, which attaches one.
A release made by hand will not have it."
  fi
  die "${REPO} has no release tagged ${VERSION} — see ${RELEASES}"
}

# The version that was actually installed, read out of the tarball rather than
# from the tag, so it is the number npm is about to register. Prints nothing if
# the tarball cannot be read, which is npm's problem to report, not this one.
package_version() {
  command -v tar >/dev/null 2>&1 || return 0
  tar -xzOf "$1" package/package.json 2>/dev/null |
    grep -o '"version": *"[^"]*"' | head -n 1 | cut -d'"' -f4
}

# ---- Installing -------------------------------------------------------------

install_package() {
  package="$1"

  if npm install --global --no-fund --no-audit "$package" >"${WORK}/npm.log" 2>&1; then
    return 0
  fi
  status=$?

  # Nearly always a global prefix owned by root. Saying so beats printing sixty
  # lines of npm log, which is kept for when it is something else.
  if grep -qi 'EACCES\|permission denied' "${WORK}/npm.log"; then
    prefix=$(npm prefix -g 2>/dev/null || echo "the npm global prefix")
    die "npm cannot write to ${prefix}.

Either install with sudo:

  curl -fsSL ${DOCS}install.sh | sudo -E sh

or point npm somewhere you own, which needs no sudo ever again:

  npm config set prefix ~/.local
  # and put ~/.local/bin on your PATH"
  fi

  printf '\nslide: npm failed to install the package.\n\n' >&2
  tail -n 20 "${WORK}/npm.log" >&2
  exit "$status"
}

verify() {
  if ! command -v slide >/dev/null 2>&1; then
    bin="$(npm prefix -g)/bin"
    printf '\nslide: installed, but %s is not on your PATH.\n\nAdd it:\n\n  export PATH="%s:$PATH"\n\n' \
      "$bin" "$bin" >&2
    exit 1
  fi

  log "slide   $(slide --version) — installed"
  printf '\nStart a deck:\n\n  slide init talk.md\n  slide dev talk.md\n\nDocs: %s\n\n' "$DOCS"
}

# ---- main -------------------------------------------------------------------

main() {
  case "${1:-}" in
    -h | --help)
      usage
      exit 0
      ;;
  esac

  trap cleanup EXIT INT TERM

  setup_downloader
  check_node

  printf '\nslide\n\n'
  log "node    $(node -v)"

  WORK=$(mktemp -d 2>/dev/null || mktemp -d -t slide)
  package="${WORK}/${ASSET}"
  url=$(asset_url)

  download "$url" "$package" || explain_failure

  # With no API call there is no tag to report before the download; the
  # tarball's own version is the more useful number anyway.
  version=$(package_version "$package")
  if [ -n "$version" ]; then
    log "release v${version}"
  else
    log "release ${VERSION}"
  fi

  install_package "$package"
  verify
}

main "$@"
