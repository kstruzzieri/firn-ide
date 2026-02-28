# Repository Rebrand Guide

A reusable, step-by-step workflow for rebranding a repository — covering the remote repo name, all code references, assets, CI/CD, and documentation.

## Overview

This guide was developed during the Arc IDE → Firn IDE rebrand and is designed to be reused for any project rename.

### Variables

Before starting, define these:

| Variable | Description | Example |
|----------|-------------|---------|
| `OLD_NAME` | Current name (title case) | Arc IDE |
| `NEW_NAME` | New name (title case) | Firn IDE |
| `OLD_LOWER` | Lowercase slug | arc |
| `NEW_LOWER` | Lowercase slug | firn |
| `OLD_REPO` | GitHub repo name | arc-ide |
| `NEW_REPO` | GitHub repo name | firn-ide |
| `OLD_MODULE` | Go module name | arc |
| `NEW_MODULE` | Go module name | firn |
| `GITHUB_ORG` | GitHub org/user | kstruzzieri |

---

## Phase 1: Audit — Find All References

Run these searches from the project root to build a complete rename map:

```bash
# Case-sensitive search for all variations
rg -l "OLD_NAME"          # e.g., "Arc IDE"
rg -l "OLD_LOWER"         # e.g., "arc"
rg -l "OLD_REPO"          # e.g., "arc-ide"
rg -li "old_name"         # Case-insensitive catch-all

# Check binary/config files that rg might skip
grep -rl "OLD_LOWER" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.toml" --include="*.mod"
```

### Common locations to check:

#### Build & Config
- [ ] `go.mod` — module name, all import paths
- [ ] `wails.json` / `tauri.conf.json` — app name, output filename
- [ ] `package.json` — name field
- [ ] `Cargo.toml` — package name
- [ ] `.env` / `.env.example` — app name variables
- [ ] `Makefile` / `Taskfile` — binary names, paths

#### Frontend
- [ ] `index.html` — `<title>` tag
- [ ] Component files — displayed text, alt text, aria labels
- [ ] Import paths referencing brand assets
- [ ] Test files — `getByText('OldName')`, snapshots

#### Backend
- [ ] Import paths (Go: `old/internal/...`, Rust: `use old::...`)
- [ ] Window titles, about dialogs
- [ ] Error messages, log prefixes
- [ ] Runtime paths (`~/.old/config/`, `~/.old/workspaces/`)

#### CI/CD
- [ ] `.github/workflows/*.yml` — artifact names, build outputs
- [ ] Docker files — image names, labels
- [ ] Release scripts — binary naming

#### Documentation
- [ ] `README.md` — title, badges, install instructions
- [ ] `CLAUDE.md` / `CONTRIBUTING.md` — project description
- [ ] `docs/` — all markdown files
- [ ] License headers (if brand name appears)

#### Assets
- [ ] SVG logos — text content, gradient IDs, comments
- [ ] App icons — `.icns`, `.ico`, `.png`
- [ ] `Info.plist` / manifest files — bundle ID, display name
- [ ] Social/OG images

---

## Phase 2: Branding Assets

Replace all visual brand assets before code changes (so imports don't break):

1. **Create new SVG assets** in the branding directory
2. **Update any icon generation** (if using a build step for .icns/.ico/.png)
3. **Update README banner image** if it embeds the old logo

---

## Phase 3: Code Changes — Inside Out

Work from the innermost references outward:

### 3a. Go Module (if applicable)
```bash
# Update module name
sed -i '' 's/module OLD_LOWER/module NEW_LOWER/' go.mod

# Update all import paths
find . -name "*.go" -exec sed -i '' 's|"OLD_LOWER/|"NEW_LOWER/|g' {} +
```

### 3b. Frontend Config
- `package.json` — name field
- `index.html` — title tag
- `vite.config.ts` / `webpack.config.js` — any name references

### 3c. App Config
- `wails.json` — name, outputfilename
- `Info.plist` — bundle identifier, display name
- App manifests

### 3d. UI Components
- Header/title bar text
- Welcome/splash screen
- About dialog
- Error boundary messages
- Logo component names and imports

### 3e. Tests
- Text matchers (`getByText`, snapshots)
- Test descriptions

### 3f. CI/CD
- Workflow artifact names
- Release asset names
- Docker image tags

### 3g. Documentation
- README.md
- All docs/*.md files
- CLAUDE.md / project guides
- Old mockup files referencing previous names

---

## Phase 4: Runtime Paths

If the app creates config/data directories:

- Update default paths: `~/.OLD_LOWER/` → `~/.NEW_LOWER/`
- Consider migration: detect old path, copy/move to new path
- Update any documentation referencing these paths

---

## Phase 5: Local Directory Rename

> **Do this before the GitHub rename** — rename the local folder first, verify everything works, then rename on GitHub.

### 5a. Rename the directory

```bash
# From the parent directory
cd ~/projects/PARENT_DIR   # e.g., ~/projects/arc-ide/github/
mv OLD_REPO NEW_REPO       # e.g., mv arc-ide firn-ide
cd NEW_REPO
```

### 5b. Verify git still works

```bash
git status          # Should show clean working tree (or your current changes)
git log --oneline -5  # Verify history is intact
git remote -v       # Note: still points to old repo name (updated in Phase 6)
```

### 5c. Update local references

These are easy to miss and cause frustrating breakage:

- [ ] **Terminal sessions** — Any open terminals with `cd` history pointing to old path
- [ ] **IDE/editor projects** — VS Code recent workspaces, JetBrains project files, etc.
- [ ] **Shell aliases/functions** — Check `~/.zshrc`, `~/.bashrc` for aliases referencing old path
- [ ] **CLAUDE.md / .claude/** — Any absolute paths in Claude Code config
- [ ] **Go workspace** — If using `go.work`, update the directory reference
- [ ] **Symlinks** — Any symlinks pointing to the old directory path
- [ ] **Git worktrees** — If using worktrees, they reference the parent repo path
- [ ] **Build scripts** — Any scripts with hardcoded absolute paths
- [ ] **Docker volumes** — If mounting the project directory in containers

### 5d. Update within the project

```bash
# Search for any absolute paths referencing the old directory name
rg "OLD_REPO" .              # Catches relative references
rg "/OLD_REPO/" .            # Catches absolute path fragments
rg "OLD_REPO" ~/.claude/     # Check Claude Code config
```

### 5e. Test that builds still work

```bash
# Language-specific build verification
go build ./...               # Go
cd frontend && npm run build # Node/React
wails build                  # Wails (if applicable)
```

---

## Phase 6: GitHub Repository Rename

> **Do this after local rename** — after all code changes are committed and pushed.

### Via GitHub UI:
1. Go to **Settings** → **General**
2. Under **Repository name**, enter the new name
3. Click **Rename**

GitHub automatically redirects the old URL → new URL, but update:
- [ ] Local git remote: `git remote set-url origin git@github.com:ORG/NEW_REPO.git`
- [ ] Any hardcoded GitHub URLs in docs, badges, CI
- [ ] Package registry entries (npm, Go proxy, etc.)
- [ ] External links (website, docs site, etc.)

### Via GitHub CLI:
```bash
gh repo rename NEW_REPO
git remote set-url origin git@github.com:ORG/NEW_REPO.git
```

---

## Phase 7: Post-Rename Verification

- [ ] `go build` / `npm run build` succeeds
- [ ] All tests pass
- [ ] App launches with correct title/branding
- [ ] CI/CD pipelines run green
- [ ] README displays correctly with new assets
- [ ] Old GitHub URL redirects properly
- [ ] Local directory name matches new repo name
- [ ] `git remote -v` shows new URL
- [ ] No stale references: `rg "OLD_REPO" .` returns nothing unexpected

---

## Required Brand Assets Checklist

Every project rebrand should produce these assets:

| Asset | Format | Location | Purpose |
|-------|--------|----------|---------|
| App icon (1024px) | PNG | `build/appicon.png` | Primary app icon (Wails/Electron/Tauri) |
| App icon (512px) | PNG | `build/icons/icon-512.png` | macOS / high-DPI |
| App icon (256px) | PNG | `build/icons/icon-256.png` | Windows / standard displays |
| App icon (128px) | PNG | `build/icons/icon-128.png` | Small icon contexts |
| SVG icon | SVG | `frontend/src/assets/branding/icon.svg` | Standalone icon (favicon, in-app) |
| SVG logo | SVG | `frontend/src/assets/branding/logo.svg` | Icon + wordmark (transparent bg) |
| SVG logo-light | SVG | `frontend/src/assets/branding/logo-light.svg` | Light background variant |
| SVG logo-dark | SVG | `frontend/src/assets/branding/logo-dark.svg` | Self-contained dark background |
| GitHub banner | SVG | `frontend/src/assets/branding/banner.svg` | README header image |
| Social/OG image | PNG | *(optional)* | Social media preview card |

**Generation workflow**: Create the SVG icon first, render to 1024px PNG, then resize down with `sips` (macOS) or ImageMagick for smaller sizes.

---

## File Organization

Recommended directory structure for brand assets and exploration files:

```
project-root/
├── frontend/src/assets/branding/    # Production assets (checked into git)
│   ├── icon.svg                     # Standalone icon
│   ├── logo.svg                     # Icon + wordmark (transparent)
│   ├── logo-light.svg               # Light background variant
│   ├── logo-dark.svg                # Self-contained dark bg
│   └── banner.svg                   # GitHub README banner
│
├── build/                           # Build-time assets
│   ├── appicon.png                  # 1024x1024 primary icon
│   └── icons/                       # Additional icon sizes
│       ├── icon-512.png
│       ├── icon-256.png
│       └── icon-128.png
│
├── docs/
│   ├── branding/
│   │   └── rebrand-guide.md         # This guide (active reference)
│   └── archive/                     # Archived/historical assets
│       ├── logos-old-era/           # Previous brand SVGs
│       └── branding-exploration/    # HTML mockups from design process
```

**Principles:**
- Production assets live in `frontend/src/assets/branding/` (importable by the app)
- Build-time PNGs live in `build/` (consumed by the build system)
- Archive old assets rather than deleting them — they document the design journey
- Keep exploration files (HTML mockups, concept screenshots) in `docs/archive/`
- Never commit exploration PNGs to the project root

---

## Post-Rebrand Cleanup

After completing a rebrand, perform this cleanup pass:

- [ ] **Archive old assets** — Move previous brand SVGs/PNGs to `docs/archive/logos-old-era/`
- [ ] **Archive exploration files** — Move HTML mockups and concept screenshots to `docs/archive/branding-exploration/`
- [ ] **Clean root directory** — Delete any stray exploration screenshots (e.g., `firn-*.png`)
- [ ] **Verify `build/appicon.png`** — Confirm it shows the new brand, not the old icon
- [ ] **Update README banner** — Ensure README references the new banner asset
- [ ] **Grep for stale references** — Run `rg "OLD_NAME" docs/` to catch any missed references in TDD docs, plans, etc.
- [ ] **Delete empty files** — Check for 0-byte TDD or plan files that were never completed
- [ ] **Remove dangling symlinks** — Check for symlinks pointing outside the repo

---

## Quick-Reference: Rename Script

A semi-automated script for the mechanical parts. **Review each step's output before proceeding.**

```bash
#!/bin/bash
# Usage: Set variables, then run each section manually

OLD_REPO="arc-ide"
NEW_REPO="firn-ide"
OLD_NAME="Arc IDE"
NEW_NAME="Firn IDE"
OLD_LOWER="arc"
NEW_LOWER="firn"
GITHUB_ORG="kstruzzieri"
PARENT_DIR="$HOME/projects"  # Parent of the repo directory

# ── Step 1: Audit (run from project root) ─────────────────
echo "=== References to old name ==="
rg -c "$OLD_NAME" --type-not binary || echo "None found"
rg -c "$OLD_REPO" --type-not binary || echo "None found"
rg -c "$OLD_LOWER" --type-not binary --glob '!node_modules' --glob '!.git' || echo "None found"

# ── Step 2: Rename local directory ─────────────────────────
# cd "$PARENT_DIR" && mv "$OLD_REPO" "$NEW_REPO" && cd "$NEW_REPO"

# ── Step 3: Rename GitHub repo ─────────────────────────────
# gh repo rename "$NEW_REPO"
# git remote set-url origin "git@github.com:$GITHUB_ORG/$NEW_REPO.git"

# ── Step 4: Verify ────────────────────────────────────────
# git remote -v
# go build ./... 2>&1 | head -20
# cd frontend && npm run build 2>&1 | tail -5
```

---

## Tips

- **Commit in logical chunks**: assets first, then backend, then frontend, then docs
- **Don't forget gradient IDs**: SVGs often have IDs like `arcGradient` that reference the old name
- **Search for abbreviations**: if old name was "Arc", also search for "ARC", "arc", "Arc"
- **Check git history won't break**: force-push is fine on feature branches, never on main
- **Old name in user-facing strings**: these are highest priority — users see them
- **Old name in internal code**: lower priority but still clean up for consistency
