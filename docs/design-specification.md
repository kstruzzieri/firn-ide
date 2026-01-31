# Flux IDE — Design Specification v1

This document consolidates all UI/UX decisions for Flux IDE, serving as the blueprint for hi-fi mockup creation and implementation.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Visual Identity & Theme](#2-visual-identity--theme)
3. [File & Language Icons](#3-file--language-icons)
4. [Workspace Model & Switching](#4-workspace-model--switching)
5. [Run Profiles UI](#5-run-profiles-ui)
6. [Search Everywhere](#6-search-everywhere)
7. [Context Menus](#7-context-menus)
8. [Keyboard Shortcuts](#8-keyboard-shortcuts)
9. [Component Specifications](#9-component-specifications)
10. [AI Chat Panel](#10-ai-chat-panel)
11. [ML Mode (Perspective)](#11-ml-mode-perspective)
12. [ML Service Integration](#12-ml-service-integration)
13. [Keyboard Shortcuts (Extended)](#13-keyboard-shortcuts-extended)

---

## 1. Design Philosophy

### Core Principles

1. **Editor-Centric Focus** — The editor is the primary workspace; surrounding UI recedes
2. **Workspace as Personality** — Each workspace type feels distinct, like switching JetBrains apps
3. **Lightweight Feel** — Instant interactions, no unnecessary animations
4. **Keyboard-First** — Every action accessible via keyboard
5. **JetBrains-Inspired UX** — Familiar patterns for productivity users

### Performance Targets

- Cold start: < 2-4 seconds
- Idle CPU: Near 0% (no polling)
- Core RAM: ~200-450MB (without language servers)
- Workspace switch: Instant (0ms transition)

---

## 2. Visual Identity & Theme

### Base Theme

**Inspiration:** Deep Ocean Theme + JetBrains Island Dark

**Key Characteristic:** Layered depth with clear editor/chrome contrast

### Surface Hierarchy

Surfaces progress from darkest (recedes) to lightest (focus):

| Surface | Role | Hex | Notes |
|---------|------|-----|-------|
| Frame/Title bar | Window chrome | `#0A0E14` | Darkest, disappears |
| Sidebar backgrounds | Project, Git panels | `#0D1117` | Secondary panels |
| Tool panel backgrounds | Terminal, Problems | `#161B22` | Bottom/auxiliary |
| Tab bar | File navigation | `#1C2128` | Between chrome and editor |
| Editor background | Primary focus | `#1E2228` | Clearly lighter than surrounds |
| Borders/dividers | Subtle separation | `#30363D` | 1px, low contrast |
| Hover states | Interactive feedback | `#21262D` | Subtle lift |

### Text Colors

| Role | Hex | Usage |
|------|-----|-------|
| Primary text | `#E6EDF3` | File names, code, labels |
| Secondary text | `#8B949E` | Paths, descriptions |
| Muted text | `#6E7681` | Shortcuts, timestamps |
| Disabled text | `#484F58` | Inactive items |

### Accent Colors (Workspace Personalities)

Each workspace type has a distinct accent color that appears in:
- Active tab indicator (left border or underline)
- Workspace badge in header
- Selected item highlights
- Status bar workspace label
- Run profile indicators when running

| Workspace Type | Accent Color | Hex | Rationale |
|----------------|--------------|-----|-----------|
| Frontend / TypeScript | Blue | `#2563EB` | WebStorm association |
| Python | Green | `#22C55E` | PyCharm association |
| Go | Cyan | `#06B6D4` | GoLand association |
| Rust | Orange | `#F97316` | Rust community color |
| Docker / Infrastructure | Purple | `#A855F7` | "Meta" / orchestration feel |
| General / Untyped | Neutral | `#6B7280` | No specific personality |

### Workspace Accent System (Implemented)

The entire IDE accent cascades from a single CSS custom property, making workspace switching visually instant. When a workspace is activated, these elements update:

**Affected Elements:**
- Header gradient tint (subtle accent wash)
- Header border glow
- Workspace selector button (background, border, dot, name color)
- Active tab indicator (top border)
- File tree selection highlight
- Activity bar active indicator
- Scrollbar thumbs
- Editor current line highlight
- Terminal prompt color
- Status bar workspace label

**CSS Implementation:**
```css
/* Accent variant classes — apply to .ide element */
.ide--accent-blue {
  --accent: #2563EB;
  --accent-dim: rgba(37, 99, 235, 0.12);
  --accent-glow: rgba(37, 99, 235, 0.25);
}

.ide--accent-green {
  --accent: #22C55E;
  --accent-dim: rgba(34, 197, 94, 0.12);
  --accent-glow: rgba(34, 197, 94, 0.25);
}

/* etc. for cyan, orange, purple, amber */
```

**Available Accents:** `blue`, `green`, `cyan`, `orange`, `purple`, `amber`

**Note:** The Flux logo maintains consistent branding (blue→purple gradient) regardless of workspace accent.

---

## 3. File & Language Icons

### Icon Design Principles

1. **Distinct at small sizes** — Icons must be recognizable at 16x16px
2. **Consistent style** — Flat design, consistent stroke weight, rounded corners
3. **Color-coded by category** — Languages, configs, data, media, etc.
4. **Monochrome option** — Support user preference for reduced color

### Icon Categories & Colors

| Category | Color Family | Hex Range |
|----------|--------------|-----------|
| JavaScript / TypeScript | Yellow / Blue | `#F7DF1E` / `#3178C6` |
| Python | Blue / Yellow | `#3776AB` / `#FFD43B` |
| Go | Cyan | `#00ADD8` |
| Rust | Orange | `#DEA584` |
| HTML / Markup | Orange | `#E34F26` |
| CSS / Styling | Blue / Purple | `#1572B6` / `#CC6699` |
| Config files | Gray / Muted | `#6B7280` |
| Data (JSON, YAML) | Yellow / Amber | `#F59E0B` |
| Images | Purple | `#8B5CF6` |
| Documentation | Blue | `#2563EB` |
| Git | Orange-Red | `#F05032` |
| Docker | Blue | `#2496ED` |
| Folders | Muted blue | `#64748B` |

### File Type Icon Mappings

#### Languages & Frameworks

| Extension(s) | Icon Name | Color | Notes |
|--------------|-----------|-------|-------|
| `.js` | javascript | `#F7DF1E` | JS logo style |
| `.mjs`, `.cjs` | javascript-module | `#F7DF1E` | With module indicator |
| `.jsx` | react | `#61DAFB` | React logo |
| `.ts` | typescript | `#3178C6` | TS logo style |
| `.tsx` | react-typescript | `#3178C6` | React + TS combined |
| `.py` | python | `#3776AB` | Python logo style |
| `.pyi` | python-stub | `#3776AB` | Lighter/outlined |
| `.go` | go | `#00ADD8` | Gopher-inspired |
| `.rs` | rust | `#DEA584` | Rust gear logo |
| `.rb` | ruby | `#CC342D` | Ruby gem |
| `.php` | php | `#777BB4` | PHP logo |
| `.java` | java | `#ED8B00` | Coffee cup style |
| `.kt`, `.kts` | kotlin | `#7F52FF` | Kotlin logo |
| `.swift` | swift | `#F05138` | Swift bird |
| `.c` | c | `#A8B9CC` | C logo |
| `.cpp`, `.cc`, `.cxx` | cpp | `#00599C` | C++ logo |
| `.h`, `.hpp` | header | `#9B4F96` | Header file |
| `.cs` | csharp | `#512BD4` | C# logo |
| `.fs`, `.fsx` | fsharp | `#378BBA` | F# logo |
| `.lua` | lua | `#000080` | Lua moon |
| `.r`, `.R` | r-lang | `#276DC3` | R logo |
| `.scala` | scala | `#DC322F` | Scala logo |
| `.ex`, `.exs` | elixir | `#6E4A7E` | Elixir drop |
| `.erl`, `.hrl` | erlang | `#A90533` | Erlang logo |
| `.hs`, `.lhs` | haskell | `#5D4F85` | Haskell logo |
| `.clj`, `.cljs` | clojure | `#5881D8` | Clojure logo |
| `.vue` | vue | `#4FC08D` | Vue logo |
| `.svelte` | svelte | `#FF3E00` | Svelte logo |
| `.astro` | astro | `#FF5D01` | Astro logo |
| `.sol` | solidity | `#363636` | Ethereum style |

#### Web & Markup

| Extension(s) | Icon Name | Color | Notes |
|--------------|-----------|-------|-------|
| `.html`, `.htm` | html | `#E34F26` | HTML5 logo |
| `.css` | css | `#1572B6` | CSS3 logo |
| `.scss`, `.sass` | sass | `#CC6699` | Sass logo |
| `.less` | less | `#1D365D` | Less logo |
| `.styl` | stylus | `#FF6347` | Stylus logo |
| `.svg` | svg | `#FFB13B` | SVG logo |
| `.xml` | xml | `#F26822` | XML tag style |
| `.xsl`, `.xslt` | xslt | `#F26822` | Transform indicator |

#### Data & Config

| Extension(s) | Icon Name | Color | Notes |
|--------------|-----------|-------|-------|
| `.json` | json | `#F59E0B` | Braces icon |
| `.yaml`, `.yml` | yaml | `#CB171E` | YAML style |
| `.toml` | toml | `#9C4121` | TOML logo |
| `.ini`, `.cfg` | config | `#6B7280` | Gear icon |
| `.env`, `.env.*` | env | `#ECD53F` | Key icon, warning color |
| `.csv` | csv | `#22C55E` | Table grid |
| `.xml` | xml | `#F26822` | Angle brackets |
| `.graphql`, `.gql` | graphql | `#E10098` | GraphQL logo |
| `.prisma` | prisma | `#2D3748` | Prisma logo |

#### Documentation

| Extension(s) | Icon Name | Color | Notes |
|--------------|-----------|-------|-------|
| `.md`, `.mdx` | markdown | `#083FA1` | Markdown logo |
| `.rst` | rst | `#141414` | reStructuredText |
| `.txt` | text | `#6B7280` | Plain text icon |
| `.pdf` | pdf | `#FF0000` | PDF logo |
| `.doc`, `.docx` | word | `#2B579A` | Word icon |

#### DevOps & Infrastructure

| Extension(s) | Icon Name | Color | Notes |
|--------------|-----------|-------|-------|
| `Dockerfile`, `.dockerfile` | docker | `#2496ED` | Docker whale |
| `docker-compose.yml` | docker-compose | `#2496ED` | Compose variant |
| `.tf`, `.tfvars` | terraform | `#7B42BC` | Terraform logo |
| `.hcl` | hcl | `#7B42BC` | HashiCorp style |
| `Makefile`, `makefile` | makefile | `#6B7280` | Build icon |
| `.sh`, `.bash`, `.zsh` | shell | `#4EAA25` | Terminal icon |
| `.ps1` | powershell | `#5391FE` | PowerShell logo |
| `.bat`, `.cmd` | batch | `#C1F12E` | Windows cmd |
| `Jenkinsfile` | jenkins | `#D24939` | Jenkins logo |
| `.github/*` | github | `#181717` | GitHub logo |
| `.gitlab-ci.yml` | gitlab | `#FC6D26` | GitLab logo |

#### Package & Lock Files

| Filename | Icon Name | Color | Notes |
|----------|-----------|-------|-------|
| `package.json` | npm | `#CB3837` | npm logo |
| `package-lock.json` | npm-lock | `#CB3837` | Lock indicator |
| `yarn.lock` | yarn | `#2C8EBB` | Yarn logo |
| `pnpm-lock.yaml` | pnpm | `#F69220` | pnpm logo |
| `Cargo.toml` | cargo | `#DEA584` | Rust cargo |
| `Cargo.lock` | cargo-lock | `#DEA584` | Lock indicator |
| `go.mod` | go-mod | `#00ADD8` | Go module |
| `go.sum` | go-sum | `#00ADD8` | Checksum variant |
| `pyproject.toml` | pyproject | `#3776AB` | Python project |
| `requirements.txt` | pip | `#3776AB` | pip style |
| `Pipfile`, `Pipfile.lock` | pipenv | `#3776AB` | Pipenv |
| `Gemfile`, `Gemfile.lock` | bundler | `#CC342D` | Ruby bundler |
| `composer.json` | composer | `#885630` | Composer logo |

#### Config Files (Specific)

| Filename Pattern | Icon Name | Color | Notes |
|------------------|-----------|-------|-------|
| `tsconfig.json`, `jsconfig.json` | tsconfig | `#3178C6` | TS gear |
| `.eslintrc.*`, `eslint.config.*` | eslint | `#4B32C3` | ESLint logo |
| `.prettierrc.*`, `prettier.config.*` | prettier | `#F7B93E` | Prettier logo |
| `vite.config.*` | vite | `#646CFF` | Vite logo |
| `webpack.config.*` | webpack | `#8DD6F9` | Webpack logo |
| `rollup.config.*` | rollup | `#FF3333` | Rollup logo |
| `tailwind.config.*` | tailwind | `#06B6D4` | Tailwind logo |
| `next.config.*` | nextjs | `#000000` | Next.js logo |
| `nuxt.config.*` | nuxt | `#00DC82` | Nuxt logo |
| `.gitignore` | gitignore | `#F05032` | Git logo muted |
| `.gitattributes` | git | `#F05032` | Git logo |
| `.editorconfig` | editorconfig | `#FEFEFE` | EditorConfig logo |
| `.nvmrc`, `.node-version` | nodejs | `#339933` | Node.js logo |
| `.python-version` | python | `#3776AB` | Python version |

#### Images & Media

| Extension(s) | Icon Name | Color | Notes |
|--------------|-----------|-------|-------|
| `.png` | image-png | `#8B5CF6` | PNG indicator |
| `.jpg`, `.jpeg` | image-jpg | `#8B5CF6` | JPG indicator |
| `.gif` | image-gif | `#8B5CF6` | GIF indicator |
| `.webp` | image-webp | `#8B5CF6` | WebP indicator |
| `.ico` | image-ico | `#8B5CF6` | Favicon style |
| `.mp3`, `.wav`, `.ogg` | audio | `#EF4444` | Audio waveform |
| `.mp4`, `.webm`, `.mov` | video | `#EF4444` | Video play icon |
| `.ttf`, `.otf`, `.woff`, `.woff2` | font | `#6B7280` | Font glyph |

#### Folders (Special)

| Folder Name | Icon Name | Color | Notes |
|-------------|-----------|-------|-------|
| `src`, `source` | folder-src | `#3B82F6` | Code folder |
| `lib`, `libs` | folder-lib | `#8B5CF6` | Library folder |
| `test`, `tests`, `__tests__` | folder-test | `#22C55E` | Test folder |
| `docs`, `documentation` | folder-docs | `#2563EB` | Docs folder |
| `public`, `static`, `assets` | folder-public | `#F59E0B` | Public assets |
| `dist`, `build`, `out` | folder-dist | `#6B7280` | Build output |
| `node_modules` | folder-node | `#339933` | Node modules (muted) |
| `.git` | folder-git | `#F05032` | Git folder |
| `.github` | folder-github | `#181717` | GitHub folder |
| `.vscode` | folder-vscode | `#007ACC` | VS Code folder |
| `components` | folder-components | `#61DAFB` | Components |
| `hooks` | folder-hooks | `#61DAFB` | React hooks |
| `pages`, `routes` | folder-pages | `#3B82F6` | Pages/routes |
| `api` | folder-api | `#22C55E` | API folder |
| `utils`, `helpers` | folder-utils | `#6B7280` | Utilities |
| `config`, `configs` | folder-config | `#F59E0B` | Config folder |
| `scripts` | folder-scripts | `#4EAA25` | Scripts folder |
| `styles`, `css` | folder-styles | `#1572B6` | Styles folder |
| `images`, `img` | folder-images | `#8B5CF6` | Images folder |
| `types`, `@types` | folder-types | `#3178C6` | TypeScript types |

### Icon Recommendations

**Option A: Use Existing Icon Set**
- [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) — MIT licensed, comprehensive
- [VSCode Icons](https://github.com/vscode-icons/vscode-icons) — MIT licensed
- [Catppuccin Icons](https://github.com/catppuccin/vscode-icons) — MIT licensed

**Option B: Custom Icon Set**
- Design custom icons following the color mappings above
- Ensure SVG format for scalability
- Provide 16px, 24px, and 32px optimized versions

---

## 4. Workspace Model & Multi-Workspace Editing

### Workspace Definition

A workspace is a focused context within a repository:
- **Root directory** — Scoped file tree (e.g., `./frontend`)
- **Type** — Frontend, Python, Go, Infrastructure, General
- **Layout state** — Persisted pane positions, open tabs, splits
- **Run Profiles** — Workspace-scoped profiles
- **Language services** — LSP servers started on-demand, paused when files close

### File Tree Views

The file tree panel has two views, toggled via dropdown at the top:

#### Project View (Unified)

Shows the entire repository with **color-coded workspace regions**. Each workspace folder has a subtle background tint (~4% opacity of its accent color).

```
┌─ PROJECT ▾ ─────────────────────────────────────────────────────────┐
│ README.md            ← no tint (root level, no workspace)           │
│ .gitignore           ← no tint                                      │
│ docker-compose.yml   ← purple tint (Infrastructure by file type)    │
│ ▼ frontend/          ┐                                              │
│   ▼ src/             │ blue tint (#2563EB at ~4% opacity)           │
│     Button.tsx       │                                              │
│     App.tsx          ┘                                              │
│ ▼ backend/           ← no tint (parent folder, not a workspace)     │
│   ▼ go/              ┐                                              │
│     handler.go       │ cyan tint (#06B6D4 at ~4% opacity)           │
│     main.go          ┘                                              │
│   ▼ python/          ┐                                              │
│     train.py         │ green tint (#22C55E at ~4% opacity)          │
│     model.py         ┘                                              │
│ ▼ infra/             ┐                                              │
│   Dockerfile         │ purple tint (#A855F7 at ~4% opacity)         │
│   terraform/         ┘                                              │
└─────────────────────────────────────────────────────────────────────┘
```

**Project View Behavior:**
- All files accessible without committing to a workspace
- LSP starts/pauses based on **open file types** (not workspace selection)
- Run Profiles panel shows **all profiles from all workspaces**, grouped by workspace
- Use case: Quick cross-cutting edits, full-stack changes, exploratory work

**File Type Association:** Files like `docker-compose.yml`, `Dockerfile`, `.tf` get their workspace tint even at repo root (logically belong to Infrastructure).

#### Workspace View (Focused)

Shows a single workspace with its root as the tree root. Workspace tabs allow switching.

```
┌─ WORKSPACE ▾ ────────────────────────────────────────────────────────┐
│ [Frontend] [Go] [Python] [Infra]   ← workspace tabs                  │
│ ─────────────────────────────────────────────────────────────────────│
│ ▼ src/               ← frontend/ becomes root                        │
│   ▼ components/                                                      │
│     Button.tsx                                                       │
│   App.tsx                                                            │
│   main.tsx                                                           │
│ package.json                                                         │
│ tsconfig.json                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

**Workspace View Behavior:**
- File tree scoped to workspace root directory
- Clicking a workspace tab switches which workspace is shown (becomes root)
- Run Profiles panel shows **only that workspace's profiles**
- Header shows workspace name + accent color
- Use case: Focused deep work in one area

### View Comparison

| Aspect | Project View | Workspace View |
|--------|--------------|----------------|
| File tree | Full repo, color-coded regions | Scoped to workspace root |
| Run Profiles | All profiles, grouped by workspace | Filtered to active workspace |
| Header | Neutral / "Project" label | Workspace name + accent |
| LSP | On-demand by file type | On-demand by file type |
| Use case | Quick edits, full-stack work | Focused deep work |

### LSP Behavior (Both Views)

- **On-demand start** — LSP starts when you open a file needing that language server
- **Pause on close** — When all files of that language are closed, LSP pauses/stops
- **Resume on reopen** — If you reopen a file, LSP resumes quickly
- **Memory efficient** — Only active language servers consume resources

### Workspace Switcher (Workspace View)

**Primary: Workspace Tabs**

In Workspace View, tabs at the top of the file tree switch between workspaces.

**Secondary: Header Dropdown**

Location: Top-left, after app logo (only in Workspace View)

```
┌─────────────────────────────────────────────────────────────────┐
│ [◇ Flux] [● Frontend ▾]  [▶ Profile ▾] [env ▾]   [Search]       │
└─────────────────────────────────────────────────────────────────┘
```

Dropdown contents:
```
┌──────────────────────────────────┐
│ WORKSPACES                       │
│ ────────────────────────────────│
│ ● Frontend        ./frontend     │  ← accent dot shows type color
│ ○ Python          ./backend/py   │
│ ○ Go              ./backend/go   │
│ ○ Infrastructure  ./infra        │
│ ────────────────────────────────│
│ + New Workspace...               │
│ ⚙ Manage Workspaces...          │
└──────────────────────────────────┘
```

**Keyboard:** `⌘⇧W` opens quick-switch palette

### Transition Behavior (Workspace View)

- **Instant snap** — No animation, immediate context switch
- File tree root, profiles, and accent color change immediately
- Open editor tabs persist across workspace switches

---

## 5. Run Profiles UI

### Concepts

- **Profile:** Single runnable command
- **Compound Profile:** Ordered sequence of profiles
- **Environment Variant:** Toggle for env files (dev/staging/prod) on same profile

### Top Toolbar

```
┌─────────────────────────────────────────────────────────────────┐
│ [Logo] [Workspace ▾]  [▶ Frontend Dev ▾] [env: dev ▾]  [⚙]     │
└─────────────────────────────────────────────────────────────────┘
```

- Profile selector with play icon
- Environment variant toggle (only when configured)
- Run/Stop/Restart controls

### Profile Selector Dropdown

**Workspace View** — Shows only the active workspace's profiles:

```
┌──────────────────────────────────────┐
│ FRONTEND                             │
│ ─────────────────────────────────── │
│ ▶  Dev Server               ⌘R       │
│ ▶  Build                             │
│ ▶  Lint                              │
│ ▶  Test                              │
│ ─────────────────────────────────── │
│ COMPOUNDS                            │
│ ▶▶ Full Stack Dev           ⌘⇧R      │
│ ─────────────────────────────────── │
│ + New Profile...                     │
│ ⚙ Edit Profiles...                   │
└──────────────────────────────────────┘
```

**Project View** — Shows all profiles grouped by workspace:

```
┌──────────────────────────────────────┐
│ FRONTEND                             │
│ ▶  Dev Server               ⌘R       │
│ ▶  Build                             │
│ ▶  Lint                              │
│ ─────────────────────────────────── │
│ GO                                   │
│ ▶  Run API                           │
│ ▶  Test                              │
│ ▶  Build                             │
│ ─────────────────────────────────── │
│ PYTHON                               │
│ ▶  Train Model                       │
│ ▶  Backtest                          │
│ ─────────────────────────────────── │
│ INFRASTRUCTURE                       │
│ ▶  Docker Up                         │
│ ▶  Docker Down                       │
│ ─────────────────────────────────── │
│ COMPOUNDS                            │
│ ▶▶ Full Stack Dev           ⌘⇧R      │
│ ─────────────────────────────────── │
│ + New Profile...                     │
│ ⚙ Edit Profiles...                   │
└──────────────────────────────────────┘
```

Visual indicators:
- `▶` Single profile
- `▶▶` Compound profile
- Green dot: Running
- Red dot: Failed

### Run Output Panel

```
┌─ RUN ──────────────────────────────────────────────────────────────┐
│ [Frontend Dev ▾] [env: dev]  [↻] [■] [🗑] [⚙]                     │
├────────────────────────────────────────────────────────────────────┤
│ $ npm run dev                                                      │
│                                                                    │
│ > frontend@1.0.0 dev                                               │
│ > vite                                                             │
│                                                                    │
│   VITE v5.0.0  ready in 342 ms                                     │
│   ➜  Local:   http://localhost:5173/                               │
│                                                                    │
│ src/components/Button.tsx:42:5         ← clickable file:line       │
│   Type error: Property 'onClick' is missing                        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Features:
- Tabs for multiple running profiles
- Clickable `file:line:col` links
- Auto-scroll with pin toggle
- Search within output (`⌘F`)
- Persist logs option

### Nice to Have: Jump to Error

When a profile fails, parse traceback/stack trace and provide:
- Clickable link to the error source
- Notification with "Jump to error" action
- Works for Python, Node/TS, Go stack traces

### Compound Execution View

```
┌─ RUN: Full Stack Dev ──────────────────────────────────────────────┐
│ [■ Stop All]                                                       │
├────────────────────────────────────────────────────────────────────┤
│ STAGES                          │ OUTPUT                           │
│ ────────────────────────────── │ ─────────────────────────────────│
│ ✓ Docker Up          00:03     │ [selected stage output]          │
│ ● Backend API        running   │                                  │
│ ○ Frontend Dev       pending   │                                  │
└────────────────────────────────────────────────────────────────────┘
```

Stage indicators: `○` pending, `●` running, `✓` completed, `✗` failed

### Status Bar

```
┌────────────────────────────────────────────────────────────────────┐
│ [Python 3.11] [main ↑2] │ ● Frontend Dev (dev) │ ● Backend API    │
└────────────────────────────────────────────────────────────────────┘
```

Click running profile → opens its output panel

---

## 6. Search Everywhere

### Trigger

- `⌘⇧P` — Opens Search Everywhere
- Double-tap `Shift` — Alternative (JetBrains style)

### Layout

```
┌─ Search Everywhere ────────────────────────────────────────────────┐
│                                                                    │
│ [All] [Files] [Symbols] [Actions] [Profiles]   [Scope: Workspace ▾]│
│                                                                    │
│ [🔍] [search query...                         ]                    │
│                                                                    │
│ FILES                                                              │
│ ─────────────────────────────────────────────────────────────────  │
│ [ts] Button.tsx              src/components/                       │
│ [ts] ButtonGroup.tsx         src/components/                       │
│                                                                    │
│ SYMBOLS                                                            │
│ ─────────────────────────────────────────────────────────────────  │
│ ƒ  handleButtonClick         Button.tsx:24                         │
│                                                                    │
│ ACTIONS                                                            │
│ ─────────────────────────────────────────────────────────────────  │
│ ⚡ Toggle Terminal            ⌘`                                   │
│                                                                    │
│ RUN PROFILES                                                       │
│ ─────────────────────────────────────────────────────────────────  │
│ ▶  Frontend Dev                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Scope Dropdown

```
┌─────────────────────────────────┐
│ ● Current Workspace (Frontend)  │  ← default
│ ○ Entire Project                │
│ ─────────────────────────────── │
│ ○ Frontend                      │
│ ○ Python                        │
│ ○ Go                            │
└─────────────────────────────────┘
```

Default: Current workspace if active, else entire project

Toggle scope: `⌘/` while search is open

### Direct Access Shortcuts

| Shortcut | Opens |
|----------|-------|
| `⌘P` | Files only |
| `⌘⇧O` | Symbols only |
| `⌘⇧A` | Actions only |

### Empty State

Shows Recent + Frequent items when query is empty

### Result Item Format

```
[Icon] [Primary Label]                    [Secondary / Path]
       [Match highlighting]               [Shortcut if action]
```

Icons use file type icons from Section 3.

---

## 7. Context Menus

### Design Style

- Background: `#161B22` (sidebar color)
- Text: `#E6EDF3` (primary)
- Shortcuts: `#6E7681` (muted)
- Hover: `#21262D` with subtle accent tint
- Border-radius: 4px
- Shadow: Subtle drop shadow
- Icons: File type icons (colored) for New submenu; monochrome elsewhere

### File Context Menu Structure

```
── New                        ›  [submenu]
─────────────────────────────────
✂  Cut                       ⌘X
📋 Copy                      ⌘C
   Copy Path/Reference...
📄 Paste                     ⌘V
─────────────────────────────────
🔍 Find Usages              ⌥F7
   Rename...                 F6
─────────────────────────────────
   Open in Split              ›
   Open In                    ›
─────────────────────────────────
   Local History              ›
   Reload from Disk
─────────────────────────────────
   Compare With...           ⌘D
─────────────────────────────────
🗑  Delete...                 ⌫
```

### "New" Submenu

Grouped by relevance, shows file type icons:

```
┌────────────────────────────────────┐
│ [go] Go File                       │
│ [file] File                        │
│ [scratch] Scratch File        ⌥⌘N │
│ [folder] Directory                 │
│ ────────────────────────────────── │
│ [js] JavaScript File               │
│ [ts] TypeScript File               │
│ [json] tsconfig.json File          │
│ [html] HTML File                   │
│ [css] Stylesheet                   │
│ ────────────────────────────────── │
│ [docker] Dockerfile                │
│ [terraform] Terraform File         │
│ [yaml] Kubernetes Resource         │
│ ────────────────────────────────── │
│ [md] Markdown File                 │
│ [json] package.json                │
└────────────────────────────────────┘
```

Contents adapt to workspace type (Python workspace shows Python files first, etc.)

---

## 8. Keyboard Shortcuts

### Global

| Action | Shortcut |
|--------|----------|
| Search Everywhere | `⌘⇧P` or `Shift Shift` |
| Go to File | `⌘P` |
| Go to Symbol | `⌘⇧O` |
| Go to Action | `⌘⇧A` |
| Switch Workspace | `⌘⇧W` |
| Toggle Terminal | `` ⌘` `` |
| Toggle Sidebar | `⌘B` |
| Settings | `⌘,` |

### Run Profiles

| Action | Shortcut |
|--------|----------|
| Run selected profile | `⌘R` |
| Run last compound | `⌘⇧R` |
| Stop current | `⌘.` |
| Switch env variant | `⌘E` |

### Editor

| Action | Shortcut |
|--------|----------|
| Save (auto-save, but manual trigger) | `⌘S` |
| Find in file | `⌘F` |
| Find and replace | `⌘⇧F` (project) / `⌘H` (file) |
| Go to line | `⌘G` |
| Go to definition | `⌘Click` or `F12` |
| Find usages | `⌥F7` |
| Rename | `F6` |
| Quick fix | `⌥Enter` |
| Format file | `⌥⌘L` |

### Navigation

| Action | Shortcut |
|--------|----------|
| Back | `⌘[` |
| Forward | `⌘]` |
| Recent files | `⌘E` |
| Next tab | `⌘⇧]` |
| Previous tab | `⌘⇧[` |
| Close tab | `⌘W` |
| Split right | `⌘\` |

### Search Palette

| Action | Shortcut |
|--------|----------|
| Navigate results | `↑` / `↓` |
| Open selected | `Enter` |
| Open in split | `⌘Enter` |
| Cycle filter tabs | `Tab` |
| Cycle scope | `⌘/` |
| Close | `Esc` |

---

## 9. Component Specifications

### Header Bar

- Height: 40px
- Background: Frame color (`#0A0E14`)
- Contains: App logo, workspace selector, profile selector, env toggle, search trigger, settings

### Sidebar

- Default width: 260px
- Min width: 200px
- Max width: 400px
- Resizable with drag handle
- Background: `#0D1117`

### Tab Bar

- Height: 36px
- Background: `#1C2128`
- Active tab: Editor background color (`#1E2228`) with accent left border
- Tab shows: File icon, filename, close button on hover

### Editor

- Background: `#1E2228`
- Gutter: Slightly darker than editor
- Active line: Subtle highlight
- Selection: Accent color at 20% opacity

### Tool Panels (Bottom)

- Default height: 200px
- Min height: 100px
- Background: `#161B22`
- Tab bar for panel switching (Terminal, Problems, Run, etc.)

### Status Bar

- Height: 24px
- Background: Frame color (`#0A0E14`)
- Contains: Language mode, encoding, line/col, git branch, running profiles

---

## Appendix: Design Tokens

For implementation, extract these as CSS custom properties or design tokens:

```css
:root {
  /* Surfaces */
  --surface-frame: #0A0E14;
  --surface-sidebar: #0D1117;
  --surface-tool-panel: #161B22;
  --surface-tab-bar: #1C2128;
  --surface-editor: #1E2228;
  --surface-hover: #21262D;
  --surface-border: #30363D;

  /* Text */
  --text-primary: #E6EDF3;
  --text-secondary: #8B949E;
  --text-muted: #6E7681;
  --text-disabled: #484F58;

  /* Accents */
  --accent-frontend: #3B82F6;
  --accent-python: #22C55E;
  --accent-go: #06B6D4;
  --accent-rust: #F97316;
  --accent-docker: #A855F7;
  --accent-general: #6B7280;

  /* Semantic */
  --status-success: #22C55E;
  --status-warning: #F59E0B;
  --status-error: #EF4444;
  --status-info: #3B82F6;

  /* Sizing */
  --header-height: 40px;
  --tab-bar-height: 36px;
  --status-bar-height: 24px;
  --sidebar-width: 260px;
  --tool-panel-height: 200px;

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}
```

---

## 10. AI Chat Panel

### Overview

An AI assistant panel for context-aware coding assistance. Primary provider is Claude, with architecture supporting multiple providers (Codex, Gemini, etc.) and multi-panel layouts.

### Panel Location

**Code Mode:** Right sidebar panel, collapsible
- Can be detached to floating window
- Multiple panels can be open simultaneously (v2.5+)

**Keyboard:** `⌘⇧I` toggles AI panel

### Layout

```
┌─ AI ASSISTANT ─────────────────────────────────────────────────────┐
│ [Claude ▾] [+ Add]                            [Context: Auto ▾] [⚙]│
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│ 🤖 Claude                                                          │
│ ──────────────────────────────────────────────────────────────────│
│ I can see you're working on `Button.tsx`. The TypeScript error     │
│ on line 42 is because `onClick` is marked as required in your      │
│ `ButtonProps` interface but you're not passing it.                 │
│                                                                    │
│ **Two options:**                                                   │
│                                                                    │
│ 1. Make `onClick` optional:                                        │
│    ```typescript                                                   │
│    onClick?: () => void;                                           │
│    ```                                                             │
│                                                                    │
│ 2. Provide a default no-op:                                        │
│    ```typescript                                                   │
│    onClick = () => {}                                              │
│    ```                                                             │
│                                                                    │
│ [Apply Option 1] [Apply Option 2] [Explain More]                   │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ 👤 You                                                             │
│ Why is my onClick handler not being called?                        │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ [Ask about selection] [Explain file] [Find bugs] [Refactor]        │
├────────────────────────────────────────────────────────────────────┤
│ > Type a message...                                    [Send ⌘↩]   │
└────────────────────────────────────────────────────────────────────┘
```

### Context Modes

| Mode | Behavior |
|------|----------|
| **Auto** | Includes current file, selection, recent errors, workspace info |
| **Selection Only** | Only includes selected code |
| **File Only** | Includes entire current file |
| **Workspace** | Includes workspace structure and relevant files |
| **Custom** | User specifies which files/context to include |

### Provider Selector

```
┌─ Select Provider ──────────────────┐
│ ● Claude (Primary)                 │
│ ○ Claude (via API key)             │
│ ○ OpenAI GPT-4                     │
│ ○ OpenAI Codex                     │
│ ○ Google Gemini                    │
│ ○ Ollama (Local)                   │
│ ─────────────────────────────────  │
│ + Configure Providers...           │
└────────────────────────────────────┘
```

### Quick Actions

Buttons for common tasks:
- **Ask about selection** — Explain highlighted code
- **Explain file** — Overview of current file's purpose
- **Find bugs** — Analyze for potential issues
- **Refactor** — Suggest improvements
- **Write tests** — Generate test cases
- **Document** — Add comments/docstrings

### Code Application

When AI suggests code changes:

```
┌─ Apply Changes ────────────────────────────────────────────────────┐
│                                                                    │
│ Button.tsx (line 9)                                                │
│ ──────────────────────────────────────────────────────────────────│
│ - onClick: () => void;                                             │
│ + onClick?: () => void;                                            │
│ ──────────────────────────────────────────────────────────────────│
│                                                                    │
│                    [Reject] [Edit] [Apply]                         │
└────────────────────────────────────────────────────────────────────┘
```

- Shows diff preview before applying
- User can edit suggestion before applying
- Undo available after apply

### Multi-Panel Layout (v2.5+)

Multiple AI assistants visible simultaneously:

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Explorer] │ [Editor]                │ [Claude]    │ [Codex]       │
│            │                         │             │               │
│            │                         │ chat...     │ chat...       │
│            │                         │             │               │
└─────────────────────────────────────────────────────────────────────┘
```

**Broadcast Mode:** Send same prompt to all active AI panels, compare responses

### Provider Configuration

```
┌─ SETTINGS: AI Providers ───────────────────────────────────────────┐
│                                                                    │
│ ─── Claude ────────────────────────────────────────────────────── │
│ API Key:        [sk-ant-••••••••••••••••••••] [Test]               │
│ Model:          [claude-sonnet-4-20250514 ▾]                           │
│ Max Tokens:     [4096        ]                                     │
│                                                                    │
│ ─── OpenAI ───────────────────────────────────────────────────── │
│ API Key:        [sk-••••••••••••••••••••    ] [Test]               │
│ Model:          [gpt-4-turbo ▾]                                    │
│                                                                    │
│ ─── Ollama (Local) ───────────────────────────────────────────── │
│ Host:           [http://localhost:11434     ]                      │
│ Model:          [codellama:13b ▾]                                  │
│                                                                    │
│                                           [Save] [Cancel]          │
└────────────────────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Toggle AI panel | `⌘⇧I` |
| Send message | `⌘↩` |
| New conversation | `⌘⇧N` |
| Clear conversation | `⌘K` |
| Ask about selection | `⌘⇧E` |

---

## 11. ML Mode (Perspective)

### Overview

ML Mode is a separate UI perspective optimized for machine learning workflows. Switching to ML Mode changes the entire interface layout while staying in the same app.

**Toggle:** Activity bar button or `⌘⇧M`

### When to Use

- Training and monitoring ML models
- Analyzing experiment results
- Comparing model performance
- Backtesting trading strategies
- Viewing SHAP/feature importance

### ML Mode Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Header: Flux ML]  [Workspace ▾]  [Backend: Connected ●]  [⚙]   │
├─────────────────────────────────────────────────────────────────────┤
│ [Experiments] │ [Experiment Detail / Backtest]      │ [AI Tutor]   │
│               │                                     │              │
│ ● run-v3      │ ┌─ Metrics ─────────────────────┐  │ 🤖 Claude    │
│   running     │ │ Sharpe: 1.94  Win: 62%        │  │              │
│ ✓ run-v2      │ │ Drawdown: -8.2%               │  │ Your model   │
│   completed   │ └───────────────────────────────┘  │ shows signs  │
│ ✗ run-v1      │                                     │ of overfit...│
│   failed      │ ┌─ Equity Curve ────────────────┐  │              │
│               │ │ [Chart]                       │  │ [Explain]    │
│ ──────────── │ └───────────────────────────────┘  │ [Fix It]     │
│ + New Run     │                                     │              │
│               │ ┌─ Feature Importance ──────────┐  │              │
│               │ │ [SHAP Summary]                │  │              │
│               │ └───────────────────────────────┘  │              │
├───────────────┴─────────────────────────────────────┴──────────────┤
│ [Data Preview] [GPU Jobs] [Training Logs]                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Panel Specifications

#### 11.1 Experiments Panel (Left)

Lists all experiments/training runs:

```
┌─ EXPERIMENTS ──────────────────────────────────────────────────────┐
│ [+ New Run]  [Filter: All ▾]  [Sort: Recent ▾]  [🔍]               │
├────────────────────────────────────────────────────────────────────┤
│ ● momentum-lstm-v3              Running                            │
│   XGBoost · AAPL · 1h          Progress: 42%                       │
│   Started 12m ago              GPU: vast-gpu-01                    │
│ ──────────────────────────────────────────────────────────────────│
│ ✓ mean-rev-v2                   Completed                          │
│   LightGBM · ETH · 15m         Sharpe: 1.82  Win: 58%              │
│   2h ago                       ↗ +0.3 vs baseline                  │
│ ──────────────────────────────────────────────────────────────────│
│ ✗ orb-optuna-sweep              Failed                             │
│   XGBoost · SPY · 5m           epoch 23/100                        │
│   5h ago                       OOM Error                           │
│ ──────────────────────────────────────────────────────────────────│
│ ✓ baseline-v1                   Completed                          │
│   XGBoost · AAPL · 1h          Sharpe: 1.12  Win: 51%              │
│   1d ago                       (baseline)                          │
└────────────────────────────────────────────────────────────────────┘
```

**Status indicators:**
- `●` Running (animated pulse)
- `✓` Completed (green)
- `✗` Failed (red)
- `○` Queued (gray)

**Filters:**
- All / Running / Completed / Failed
- By model type (XGBoost, LSTM, etc.)
- By symbol/asset
- By date range

#### 11.2 Experiment Detail Panel (Center)

Shows details for selected experiment:

**Metrics Card:**
```
┌─ METRICS ──────────────────────────────────────────────────────────┐
│                                                                    │
│  Sharpe Ratio     Win Rate       Max Drawdown    Profit Factor    │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐      │
│  │  1.94   │     │  62%    │     │  -8.2%  │     │  2.1    │      │
│  │  ↑ 0.82 │     │  ↑ 11%  │     │  ↑ 4.2% │     │  ↑ 0.8  │      │
│  └─────────┘     └─────────┘     └─────────┘     └─────────┘      │
│  vs baseline     vs baseline     vs baseline     vs baseline       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Equity Curve:**
```
┌─ EQUITY CURVE ─────────────────────────────────────────────────────┐
│ [Model ▾] [Benchmark ▾] [Period: 1Y ▾]                             │
├────────────────────────────────────────────────────────────────────┤
│ $                                                                  │
│ 150k │                                              ╱──            │
│      │                                    ╱────────╱               │
│ 125k │                          ╱────────╱                         │
│      │                ╱────────╱                                   │
│ 100k │──────────────╱                                              │
│      └────────────────────────────────────────────────────────────│
│        Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct  │
│                                                                    │
│  ── Model (momentum-lstm-v3)    ── Benchmark (SPY)                 │
└────────────────────────────────────────────────────────────────────┘
```

**Feature Importance (SHAP):**
```
┌─ FEATURE IMPORTANCE ───────────────────────────────────────────────┐
│ [SHAP Summary ▾]  [Top 10 ▾]                                       │
├────────────────────────────────────────────────────────────────────┤
│ rsi_14          ████████████████████████  0.234                    │
│ macd_signal     ███████████████████       0.189                    │
│ volume_sma_20   ██████████████            0.142                    │
│ bb_width        ████████████              0.118                    │
│ atr_14          ██████████                0.098                    │
│ close_pct_1d    ████████                  0.076                    │
│ vwap_distance   ██████                    0.054                    │
│ sentiment_score █████                     0.043                    │
│ hour_of_day     ████                      0.031                    │
│ day_of_week     ██                        0.015                    │
└────────────────────────────────────────────────────────────────────┘
```

**Trade Log:**
```
┌─ TRADE LOG ────────────────────────────────────────────────────────┐
│ [Filter: All ▾]  [Export CSV]                         847 trades   │
├────────────────────────────────────────────────────────────────────┤
│ Date         Time    Action  Symbol  Qty    Entry     Exit    P&L  │
│ ──────────────────────────────────────────────────────────────────│
│ 2025-01-15   10:30   BUY     AAPL    150   $182.50  $185.20  +1.5% │
│ 2025-01-14   14:00   SELL    AAPL    150   $180.00  $178.50  +0.8% │
│ 2025-01-14   09:45   BUY     AAPL    150   $179.20  $180.00  +0.4% │
│ 2025-01-13   15:30   SELL    AAPL    100   $181.00  $182.50  -0.8% │
│ ...                                                                │
└────────────────────────────────────────────────────────────────────┘
```

#### 11.3 AI Tutor Panel (Right)

Context-aware ML assistance:

```
┌─ AI TUTOR ─────────────────────────────────────────────────────────┐
│ [Claude ▾]                                  [Context: Experiment]  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│ 🤖 Claude                                                          │
│ ──────────────────────────────────────────────────────────────────│
│ Looking at your **momentum-lstm-v3** results:                      │
│                                                                    │
│ **Good signs:**                                                    │
│ • Sharpe improved from 1.12 → 1.94                                 │
│ • Win rate up 11% vs baseline                                      │
│                                                                    │
│ **Concerns:**                                                      │
│ • The walk-forward validation shows a 0.4 Sharpe drop in the       │
│   out-of-sample period. This suggests **overfitting**.             │
│                                                                    │
│ **Recommendations:**                                               │
│ 1. Reduce LSTM layers from 3 → 2                                   │
│ 2. Add dropout (0.3) between layers                                │
│ 3. Try L2 regularization on the dense layer                        │
│                                                                    │
│ Want me to show the code changes?                                  │
│                                                                    │
│ [Show Code] [Explain Overfitting] [Try Different Model]            │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ > Why is RSI the most important feature?                           │
│   [Send]                                                           │
└────────────────────────────────────────────────────────────────────┘
```

**Capabilities:**
- Sees current experiment data, metrics, config
- Explains ML concepts in beginner-friendly terms
- Suggests hyperparameter changes
- Can generate code fixes
- Links to relevant documentation/tutorials

#### 11.4 Data Preview Panel (Bottom)

Quick dataset inspection:

```
┌─ DATA: AAPL_1h_ohlcv ──────────────────────────────────────────────┐
│ [Dataset ▾]  Rows: 8,760  Cols: 12  Period: 2024-01-01 → 2025-01-01│
├─────┬────────────────────┬─────────┬─────────┬─────────┬──────────┤
│     │ timestamp          │ open    │ high    │ low     │ close    │
├─────┼────────────────────┼─────────┼─────────┼─────────┼──────────┤
│ 0   │ 2025-01-15 10:00   │ 182.50  │ 183.20  │ 182.10  │ 182.90   │
│ 1   │ 2025-01-15 11:00   │ 182.90  │ 184.00  │ 182.80  │ 183.50   │
│ 2   │ 2025-01-15 12:00   │ 183.50  │ 183.80  │ 183.00  │ 183.20   │
│ ... │                    │         │         │         │          │
├─────┴────────────────────┴─────────┴─────────┴─────────┴──────────┤
│ [Statistics]  [Chart]  [Correlation]  [Missing Values]  [Export]   │
└────────────────────────────────────────────────────────────────────┘
```

**Tabs:**
- **Statistics** — Mean, std, min, max, quartiles per column
- **Chart** — Quick line/candlestick visualization
- **Correlation** — Heatmap of feature correlations
- **Missing Values** — Identify gaps in data

#### 11.5 GPU Jobs Panel (Bottom)

Monitor GPU training jobs:

```
┌─ GPU JOBS ─────────────────────────────────────────────────────────┐
│ [Backend: Vast.ai ▾]  [Refresh]              Est. Cost: $3.20/hr   │
├────────────────────────────────────────────────────────────────────┤
│ GPU                  Status    Job                      Progress   │
│ ──────────────────────────────────────────────────────────────────│
│ vast-gpu-01          Active    momentum-lstm-v3         42%        │
│ RTX 4090 · $0.40/hr           Epoch 42/100 · ETA 1h30m             │
│ ──────────────────────────────────────────────────────────────────│
│ vast-gpu-02          Idle      —                        —          │
│ A100 · $1.20/hr               Available                            │
│ ──────────────────────────────────────────────────────────────────│
│ QUEUE                                                              │
│ ○ optuna-sweep-v2              Waiting for GPU                     │
│ ○ sentiment-model-retrain      Waiting for GPU                     │
├────────────────────────────────────────────────────────────────────┤
│ [+ Submit Job]  [Pause Queue]  [Stop All]                          │
└────────────────────────────────────────────────────────────────────┘
```

#### 11.6 Training Logs Panel (Bottom)

Real-time training output:

```
┌─ TRAINING LOGS: momentum-lstm-v3 ──────────────────────────────────┐
│ [Auto-scroll ✓]  [Filter: All ▾]  [Clear]  [Export]                │
├────────────────────────────────────────────────────────────────────┤
│ 10:45:23 [INFO]  Starting training: momentum-lstm-v3               │
│ 10:45:24 [INFO]  Loading dataset: AAPL_1h_ohlcv (8,760 rows)       │
│ 10:45:25 [INFO]  Feature engineering: 47 features generated        │
│ 10:45:26 [INFO]  Train/Val/Test split: 70/15/15                    │
│ 10:45:30 [INFO]  Epoch 1/100 - loss: 0.0891 - val_loss: 0.0923     │
│ 10:45:35 [INFO]  Epoch 2/100 - loss: 0.0754 - val_loss: 0.0812     │
│ ...                                                                │
│ 10:58:12 [INFO]  Epoch 42/100 - loss: 0.0234 - val_loss: 0.0298    │
│ 10:58:12 [WARN]  Val loss increasing - possible overfitting        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Model Comparison View

Side-by-side comparison of multiple models:

```
┌─ COMPARE MODELS ───────────────────────────────────────────────────┐
│ [+ Add Model]  [Export Comparison]                                 │
├────────────────────────────────────────────────────────────────────┤
│                        lstm-v3     mean-rev-v2    baseline         │
│ ──────────────────────────────────────────────────────────────────│
│ Model Type             LSTM        LightGBM       XGBoost          │
│ Symbol                 AAPL        ETH            AAPL             │
│ Timeframe              1h          15m            1h               │
│ ──────────────────────────────────────────────────────────────────│
│ Sharpe Ratio           1.94        1.82           1.12             │
│ Win Rate               62%         58%            51%              │
│ Max Drawdown           -8.2%       -6.1%          -12.4%           │
│ Profit Factor          2.1         1.9            1.3              │
│ Total Trades           847         1,203          956              │
│ Avg Trade Duration     4.2h        1.8h           3.5h             │
│ ──────────────────────────────────────────────────────────────────│
│ Training Time          2h 15m      45m            30m              │
│ GPU Cost               $0.90       $0.30          $0.20            │
├────────────────────────────────────────────────────────────────────┤
│ [Equity Curves]  [Feature Importance]  [Trade Distribution]        │
└────────────────────────────────────────────────────────────────────┘
```

---

## 12. ML Service Integration

### Architecture

Flux IDE uses a **Service Adapter Pattern** to integrate with any ML backend:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Flux IDE                                                         │
│                                                                     │
│  ┌─────────────────┐    ┌──────────────────────────────────────┐   │
│  │ ML Mode Panels  │───▶│ MLServiceAdapter (Interface)         │   │
│  │ - Experiments   │    │                                      │   │
│  │ - Backtest      │    │  listExperiments()                   │   │
│  │ - Training      │    │  getTrainingStatus(jobId)            │   │
│  └─────────────────┘    │  runBacktest(config)                 │   │
│                         │  getModels()                         │   │
│                         │  getFeatureImportance(modelId)       │   │
│                         └──────────────────────────────────────┘   │
│                                        │                            │
│                    ┌───────────────────┼───────────────────┐       │
│                    ▼                   ▼                   ▼       │
│           ┌──────────────┐    ┌──────────────┐    ┌─────────────┐ │
│           │ Custom gRPC  │    │ MLflow       │    │ Weights &   │ │
│           │ Adapter      │    │ Adapter      │    │ Biases      │ │
│           │              │    │              │    │ Adapter     │ │
│           │ (Your app)   │    │ (REST API)   │    │ (REST API)  │ │
│           └──────────────┘    └──────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Adapter Interface

```typescript
interface MLServiceAdapter {
  // Connection
  connect(config: ConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  getConnectionStatus(): ConnectionStatus

  // Experiments
  listExperiments(filter?: ExperimentFilter): Promise<Experiment[]>
  getExperiment(id: string): Promise<ExperimentDetail>
  createExperiment(config: ExperimentConfig): Promise<Experiment>
  deleteExperiment(id: string): Promise<void>

  // Training
  startTraining(config: TrainingConfig): Promise<TrainingJob>
  stopTraining(jobId: string): Promise<void>
  getTrainingStatus(jobId: string): Promise<TrainingStatus>
  streamTrainingProgress(jobId: string): AsyncIterable<ProgressUpdate>
  getTrainingLogs(jobId: string): Promise<LogEntry[]>

  // Models
  listModels(filter?: ModelFilter): Promise<Model[]>
  getModel(modelId: string): Promise<ModelDetail>
  getModelMetrics(modelId: string): Promise<ModelMetrics>
  getFeatureImportance(modelId: string): Promise<FeatureImportance>
  exportModel(modelId: string): Promise<Blob>
  importModel(file: File): Promise<Model>

  // Backtesting
  runBacktest(config: BacktestConfig): Promise<BacktestResult>
  getBacktestHistory(): Promise<BacktestSummary[]>
  getBacktestDetail(id: string): Promise<BacktestDetail>

  // Data
  listDatasets(): Promise<Dataset[]>
  getDataset(id: string): Promise<DatasetDetail>
  previewDataset(id: string, limit?: number): Promise<DataPreview>
  getDatasetStatistics(id: string): Promise<DatasetStats>

  // GPU (optional)
  getGPUStatus?(): Promise<GPUStatus[]>
  getGPUJobs?(): Promise<GPUJob[]>
  submitGPUJob?(config: GPUJobConfig): Promise<GPUJob>
  cancelGPUJob?(jobId: string): Promise<void>
}
```

### Backend Configuration

```
┌─ SETTINGS: ML Backend ─────────────────────────────────────────────┐
│                                                                    │
│  Backend Type:  [Custom gRPC ▾]                                    │
│                                                                    │
│  ┌─ Available Backends ────────────────────────────────────────┐  │
│  │ ○ None (standalone mode)                                     │  │
│  │ ○ MLflow (REST API)                                          │  │
│  │ ○ Weights & Biases (REST API)                                │  │
│  │ ● Custom gRPC Service                                        │  │
│  │ ○ Custom REST API                                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ─── gRPC Configuration ───────────────────────────────────────── │
│                                                                    │
│  Server Address:    [localhost:50051          ]                    │
│  Proto File:        [~/trading/proto/ml.proto ] [Browse]           │
│  Use TLS:           [ ] Enable secure connection                   │
│  Auth Token:        [••••••••••••             ] (optional)         │
│                                                                    │
│  ─── Method Mapping ───────────────────────────────────────────── │
│                                                                    │
│  List Experiments:  [MLService.ListModels     ▾]  Auto-detected    │
│  Training Status:   [MLService.GetTrainingStatus ▾]                │
│  Run Backtest:      [MLService.RunBacktest    ▾]                   │
│  Stream Progress:   [MLService.StreamPredictions ▾]                │
│  Feature Importance:[MLService.GetFeatureImportance ▾]             │
│                                                                    │
│  [Test Connection]                              [Save] [Cancel]    │
└────────────────────────────────────────────────────────────────────┘
```

### Features

1. **Proto file parsing** — IDE reads `.proto` to discover available methods
2. **Server reflection** — Alternative: auto-discover methods without proto file
3. **Method mapping** — Map IDE features to your service's actual method names
4. **Field mapping** — Configure how response fields map to IDE's expected format
5. **Presets** — Save configurations (e.g., "Trading Platform Dev", "Production")

### Built-in Adapters

| Backend | Type | Status |
|---------|------|--------|
| Standalone | File-based | v2.0 |
| Custom gRPC | gRPC | v2.5 |
| Custom REST | REST API | v2.5 |
| MLflow | REST API | v3.0 |
| Weights & Biases | REST API | v3.0 |

---

## 13. Keyboard Shortcuts (Extended)

### AI Panel

| Action | Shortcut |
|--------|----------|
| Toggle AI panel | `⌘⇧I` |
| Send message | `⌘↩` |
| New conversation | `⌘⇧N` |
| Clear conversation | `⌘K` |
| Ask about selection | `⌘⇧E` |
| Focus AI input | `⌘⇧;` |

### ML Mode

| Action | Shortcut |
|--------|----------|
| Toggle ML Mode | `⌘⇧M` |
| New experiment | `⌘N` |
| Run selected experiment | `⌘R` |
| Stop training | `⌘.` |
| Compare selected | `⌘⇧C` |
| Export results | `⌘⇧X` |
| Focus experiments list | `⌘1` |
| Focus detail panel | `⌘2` |
| Focus AI tutor | `⌘3` |

---

## Appendix: Roadmap Summary

### v1.0 — Code Mode
- IDE shell with workspaces, run profiles, search
- File explorer, editor, terminal
- Git integration
- Theme and visual identity

### v1.5 — AI Chat Panel
- Claude integration (primary)
- Context-aware assistance
- Code application with diff preview
- Provider architecture (ready for multi-provider)

### v2.0 — ML Mode
- Perspective switch (Code ↔ ML)
- Experiment tracker panel
- Backtest visualization
- AI Tutor (ML-focused Claude assistance)
- Standalone experiment tracking (file-based)

### v2.5 — Multi-AI & gRPC Integration
- Multiple AI panels visible simultaneously
- Broadcast mode (compare AI responses)
- Custom gRPC adapter for ML backends
- Custom REST adapter

### v3.0 — Advanced ML Integration
- Data preview panel
- GPU job monitoring
- MLflow adapter
- Weights & Biases adapter
- Model comparison view

---

*Document version: 2.0*
*Last updated: January 2026*
