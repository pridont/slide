#!/bin/sh
#
# Installs the `slide` CLI from a GitHub release.
#
#   curl -fsSL https://pridont.github.io/slide/install.sh | sh
#
# It resolves a release (the latest, unless SLIDE_VERSION says otherwise),
# downloads the npm tarball attached to it, and installs it globally with npm.
# npm is what resolves the runtime dependencies, so there is no vendored
# node_modules to go stale and nothing platform-specific to pick.
#
# Everything lives in functions and runs from main() at the bottom, so a
# truncated download cannot execute half an installer.
#
set -eu

REPO="${SLIDE_REPO:-pridont/slide}"
VERSION="${SLIDE_VERSION:-latest}"
API="https://api.github.com/repos/${REPO}/releases"
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
  GITHUB_TOKEN    used for the API call, against rate limits or a private repo
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

# Prints "<tag> <tarball url>".
resolve_release() {
  if [ "$VERSION" = "latest" ]; then
    url="${API}/latest"
  else
    url="${API}/tags/${VERSION}"
  fi

  # A repository with no releases answers 404, exactly as an unknown tag does,
  # so which of the two it was has to come from what was asked for.
  if ! release=$(fetch "$url"); then
    if [ "$VERSION" = "latest" ]; then
      die "${REPO} has no published release yet — or the GitHub API is unreachable.

Install from source instead:

  git clone https://github.com/${REPO}.git
  cd slide && npm install && npm run build && npm install -g ."
    fi
    die "${REPO} has no release tagged ${VERSION}."
  fi

  tag=$(printf '%s\n' "$release" | grep -o '"tag_name": *"[^"]*"' | head -n 1 | cut -d'"' -f4)
  asset=$(printf '%s\n' "$release" |
    grep -o '"browser_download_url": *"[^"]*\.tgz"' | head -n 1 | cut -d'"' -f4)

  [ -n "$tag" ] || die "the GitHub API returned no release for ${REPO}."
  [ -n "$asset" ] || die "release ${tag} has no .tgz asset attached to it.

Every release is built by the repository's own workflow, which attaches one.
A release made by hand will not have it."

  printf '%s %s\n' "$tag" "$asset"
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

  resolved=$(resolve_release)
  tag=${resolved% *}
  asset=${resolved#* }
  log "release $tag"

  WORK=$(mktemp -d 2>/dev/null || mktemp -d -t slide)
  package="${WORK}/slide.tgz"

  download "$asset" "$package" || die "could not download ${asset}"
  log "package $(basename "$asset")"

  install_package "$package"
  verify
}

main "$@"
