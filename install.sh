#!/bin/sh
# Firn IDE one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/kstruzzieri/firn-ide/develop/install.sh | sh
#
# Resolves the platform binary from the latest GitHub release, downloads it, and
# installs it. Supports macOS (arm64/amd64) and Linux (amd64). Windows users:
# use the manual zip from the Releases page.
#
# Env overrides:
#   FIRN_VERSION   pin a release tag (e.g. v0.10.0) instead of "latest"
#   FIRN_DRY_RUN   set to 1 to print the resolved URL + target dir and exit
#
# ponytail: no checksum/signature verification of the download -- binaries are
# unsigned today; add when code signing/notarization lands.

set -e

REPO="kstruzzieri/firn-ide"

err() {
	echo "firn-install: $*" >&2
	exit 1
}

# Detect OS -> macos|linux
os_raw=$(uname -s)
case "$os_raw" in
	Darwin) OS=macos ;;
	Linux) OS=linux ;;
	*) err "unsupported OS '$os_raw' (macOS and Linux only; Windows: download the zip from https://github.com/$REPO/releases/latest)" ;;
esac

# Detect arch -> amd64|arm64
arch_raw=$(uname -m)
case "$arch_raw" in
	x86_64 | amd64) ARCH=amd64 ;;
	arm64 | aarch64) ARCH=arm64 ;;
	*) err "unsupported architecture '$arch_raw'" ;;
esac

# Map platform -> release asset name
if [ "$OS" = macos ]; then
	ASSET="Firn-macos-$ARCH.zip"
else
	# Linux has only an amd64 build today.
	if [ "$ARCH" != amd64 ]; then
		err "no Linux $ARCH build available yet (only amd64). Build from source: https://github.com/$REPO#development"
	fi
	ASSET="Firn-linux-amd64.tar.gz"
fi

# Resolve download URL: pinned tag, or scrape the latest release for the asset.
if [ -n "$FIRN_VERSION" ]; then
	URL="https://github.com/$REPO/releases/download/$FIRN_VERSION/$ASSET"
else
	api="https://api.github.com/repos/$REPO/releases/latest"
	# Grab the browser_download_url whose value ends in our asset name.
	URL=$(curl -fsSL "$api" \
		| grep -o "https://github.com/$REPO/releases/download/[^\"]*/$ASSET" \
		| head -n 1)
	[ -n "$URL" ] || err "could not find asset '$ASSET' in the latest release ($api)"
fi

# Pick install target (per-OS), preferring a system location, falling back to
# a user-writable one so the script works without sudo.
if [ "$OS" = macos ]; then
	if [ -w /Applications ] || [ ! -e /Applications ]; then
		DEST_DIR=/Applications
	else
		DEST_DIR="$HOME/Applications"
	fi
else
	if [ -w /usr/local/bin ]; then
		DEST_DIR=/usr/local/bin
	else
		DEST_DIR="$HOME/.local/bin"
	fi
fi

if [ "$FIRN_DRY_RUN" = 1 ]; then
	echo "os:       $OS"
	echo "arch:     $ARCH"
	echo "asset:    $ASSET"
	echo "url:      $URL"
	echo "dest_dir: $DEST_DIR"
	exit 0
fi

command -v curl >/dev/null 2>&1 || err "curl is required but not found"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $ASSET ..."
curl -fsSL "$URL" -o "$tmp/$ASSET" || err "download failed: $URL"

if [ "$OS" = macos ]; then
	command -v unzip >/dev/null 2>&1 || err "unzip is required but not found"
	unzip -q "$tmp/$ASSET" -d "$tmp" || err "unzip failed"
	[ -d "$tmp/Firn.app" ] || err "Firn.app not found in archive"

	mkdir -p "$DEST_DIR"
	app="$DEST_DIR/Firn.app"
	rm -rf "$app"
	mv "$tmp/Firn.app" "$app"
	# Clear the quarantine flag so Gatekeeper does not block first launch.
	xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

	echo "Installed Firn.app to $DEST_DIR"
	echo "Launch it from Finder, or run: open '$app'"
else
	command -v tar >/dev/null 2>&1 || err "tar is required but not found"
	tar -xzf "$tmp/$ASSET" -C "$tmp" || err "extract failed"
	[ -f "$tmp/firn" ] || err "firn binary not found in archive"

	mkdir -p "$DEST_DIR"
	bin="$DEST_DIR/firn"
	mv "$tmp/firn" "$bin"
	chmod +x "$bin"

	echo "Installed firn to $DEST_DIR"
	case ":$PATH:" in
		*":$DEST_DIR:"*) echo "Launch it with: firn" ;;
		*) echo "Add $DEST_DIR to your PATH, then launch with: firn" ;;
	esac
fi
