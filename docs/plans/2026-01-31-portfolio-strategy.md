# Flux IDE Portfolio Strategy

**Date:** January 31, 2026
**Purpose:** Revised roadmap for Flux IDE ML Mode development.

---

## Executive Summary

This plan pivots Flux IDE from a general-purpose IDE toward a **reward model development platform**. The goal is a demonstration of:

- Sophisticated architectural thinking
- User-focused design for ML researchers
- Quality execution on a complex application
- Deep understanding of reward model workflows

**Target feature:** *"Would this help a researcher debug a reward hacking bug faster?"*

---

## Strategic Decisions

### What We're Optimizing For

| Priority | Description |
|----------|-------------|
| 1 | Code quality and polish over feature count |
| 2 | Reward model-specific features over generic IDE features |
| 3 | Offline-first, lightweight architecture over integrations |
| 4 | Working demo over complete product |

### Key Differentiators from MLflow/W&B

| Feature | MLflow/W&B | Flux IDE |
|---------|------------|----------|
| Architecture | Server required | SQLite, works offline |
| Focus | Generic ML | Reward model-specific |
| Integration | Separate UI | Inline with editor |
| Comparison | Limited | First-class experiment diff |
| Reward hacks | Manual analysis | Auto-detection patterns |
| Weight | 100s MB | ~15MB binary |

---

## Phase 1A: Foundation Polish

**Timeline:** Current → ~1-2 weeks
**Goal:** Professional, polished IDE shell that demonstrates quality craftsmanship.

### GitHub Issues to Complete

| Issue | Title | Priority |
|-------|-------|----------|
| #12 | Editor - Open Files from Explorer | In Progress |
| #13 | Editor - Save File | High |
| #14 | Terminal - PTY Backend | High |
| #15 | Terminal - xterm.js Integration | High |
| #17 | Workspace - Open Folder Dialog | High |

### Additional Work (From UI/UX Review)

| Task | Category |
|------|----------|
| Panel resizing (drag borders) | Core UX |
| Panel collapsing (click to hide/show) | Core UX |
| TreeNode React.memo with custom comparison | Performance |
| TypeScript upgrade to 5.7+ | Critical dependency |
| Vite upgrade to 6.x | Critical dependency |
| Fix disabled text contrast (#4a6070) | Accessibility |

### Explicitly Deferred

| Issue | Title | Reason |
|-------|-------|--------|
| #16 | Terminal - Multiple Sessions | Nice-to-have |
| #18 | Workspace - Persistence | Polish feature |
| #19 | Workspace - Recent Projects | Polish feature |
| #23 | LSP - Client Implementation | Large scope, not ML-focused |
| #24 | LSP - TypeScript Integration | Large scope, not ML-focused |
| #25 | LSP - Diagnostics Display | Large scope, not ML-focused |
| #26 | LSP - Autocomplete | Large scope, not ML-focused |
| #27 | Search - ripgrep Integration | Not ML-focused |
| #28 | Search - UI Panel | Not ML-focused |
| #29 | Search - Find in File | Not ML-focused |
| #30 | Git - Status Display | Deprioritized per ml-ops-strategy |
| #31 | Git - Basic Operations | Deprioritized per ml-ops-strategy |
| #33 | Bug: Add Button Type Attributes | Minor |

### Exit Criteria

- [ ] Editor opens and saves files
- [ ] Terminal runs commands with PTY
- [ ] Panels resize smoothly via drag
- [ ] File tree performs well with 1000+ nodes
- [ ] No accessibility contrast violations
- [ ] Dependencies upgraded (TS 5.7+, Vite 6.x)

---

## Phase 1B: ML Mode Foundation

**Timeline:** ~2-3 weeks after Phase 1A
**Goal:** Establish the technical architecture for ML features.

### Mode Switcher

- Toggle in header: Code ↔ ML
- Keyboard shortcut: ⌘⇧M
- Layout transforms completely between modes
- Shared: file system, theme, terminal

### SQLite Backend

```sql
CREATE TABLE experiments (
    id TEXT PRIMARY KEY,
    name TEXT,
    config JSON,
    parent_id TEXT,  -- For experiment forking/lineage
    status TEXT,     -- pending, running, completed, failed
    created_at INTEGER,
    updated_at INTEGER
);

CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    experiment_id TEXT,
    timestamp INTEGER,
    type TEXT,       -- metric, config_change, alert, checkpoint
    data JSON,
    FOREIGN KEY (experiment_id) REFERENCES experiments(id)
);

CREATE TABLE metrics (
    experiment_id TEXT,
    step INTEGER,
    name TEXT,
    value REAL,
    timestamp INTEGER,
    PRIMARY KEY (experiment_id, step, name)
);

CREATE TABLE reward_signals (
    experiment_id TEXT,
    step INTEGER,
    component TEXT,  -- helpfulness, harmlessness, honesty
    value REAL,
    distribution JSON,
    PRIMARY KEY (experiment_id, step, component)
);
```

### Event Sourcing

- All experiment activity stored as immutable events
- Enables replay and "time travel" debugging
- Differentiator: understand *how* a model evolved, not just endpoints

### Structured Logging

Training output parsed into JSON Lines:
```json
{"ts": 1706745600, "type": "metric", "step": 1000, "data": {"loss": 0.234, "reward": 0.89}}
{"ts": 1706745601, "type": "warning", "category": "reward_hack", "data": {"pattern": "length_gaming"}}
```

### Go Backend Structure

```
internal/
  events/
    store.go       # Event sourcing foundation
    bus.go         # Event types and pub/sub
  experiment/
    config.go      # Typed experiment config
    runner.go      # Launch interface
  metrics/
    store.go       # SQLite metrics store
    streaming.go   # Real-time ingestion
```

### Frontend Structure

```
src/
  stores/
    mlStore.ts     # ML Mode state
  components/
    MLMode/
      ExperimentList/
      MetricsDashboard/
      RewardHealth/
```

### Exit Criteria

- [ ] Mode switcher toggles between Code and ML layouts
- [ ] SQLite database created on workspace open
- [ ] Events can be appended and replayed
- [ ] Experiment list displays from database
- [ ] Basic metrics chart renders (uPlot)

---

## Phase 1C: Reward Model Features

**Timeline:** ~2-3 weeks after Phase 1B
**Goal:** Key features that demonstrate understanding of reward model workflows.

### Reward Signal Health Dashboard

**Panels:**
- Distribution plots of reward scores over time
- Per-component breakdown (helpfulness, harmlessness, honesty)
- Trend indicators with anomaly highlighting
- Clickable annotations (checkpoints, config changes, alerts)

**Mockup:**
```
┌─ Reward Signal Health ──────────────────────────────────────────────┐
│  experiment: reward-model-v3.2   [Live] ●                    12h 34m │
├─────────────────────────────────────────────────────────────────────┤
│  Loss ──────────────────────────────────────────────────────────    │
│  2.4 ┤    ╭──╮                                                      │
│  1.8 ┤───╯  ╰────╮                                       ▲ LR bump  │
│  1.2 ┤           ╰──────────────────────────────────────╯           │
│  0.6 ┤                                         ╰────────────────    │
│      └──────────────────────────────────────────────────────────    │
│       0        2k        4k        6k        8k       10k    step   │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─ Reward ───────────┐  ┌─ KL Divergence ─────┐  ┌─ Gradient ────┐ │
│  │  ▁▂▃▄▅▆▇█▇▆▅▆▇█▇▆  │  │  ▇▆▅▄▃▃▂▂▂▂▁▁▁▁▁   │  │  ▂▃▄▃▂▃▄▃▂   │ │
│  │  curr: 0.847       │  │  curr: 0.042        │  │  norm: 1.23   │ │
│  └────────────────────┘  └─────────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Experiment Comparison Matrix

**Features:**
- Side-by-side metrics from 2+ runs
- Automatic config diff highlighting
- Metric trajectories overlaid on same axes
- Statistical significance indicators
- One-click "set as baseline"

**Mockup:**
```
┌─ Experiment Comparison ─────────────────────────────────────────────┐
│  [exp-v3.2-baseline]  vs  [exp-v3.3-new-reward]                     │
├─────────────────────────────┬───────────────────────────────────────┤
│  final loss: 0.847          │  final loss: 0.721  ▼ -14.9%          │
│  reward (mean): 0.723       │  reward (mean): 0.801  ▲ +10.8%       │
│  KL divergence: 0.089       │  KL divergence: 0.112  ⚠ above target │
├─────────────────────────────┴───────────────────────────────────────┤
│  Config Diff:                                                       │
│  - learning_rate: 1e-4 → 5e-5                                       │
│  - reward_model: v2.1 → v2.3                                        │
│  + dropout: 0.1 (new)                                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Reward Hack Detection

**Built-in patterns:**
- Length gaming (reward correlates with response length)
- Sycophancy (excessive agreement with user premise)
- Reward collapse (variance approaching zero)
- KL divergence drift (policy straying from base model)

**Alert panel:**
```
┌─ Reward Hacks ──────────────────────────────────────────────────────┐
│  [Auto-Detect: ON]  [Patterns: 4 active]  [Last scan: 2m ago]       │
├─────────────────────────────────────────────────────────────────────┤
│  ⚠ LENGTH_GAMING   0.73 correlation between reward and length      │
│    → Responses 40% longer than baseline                             │
│    [View Examples] [Ignore Pattern]                                 │
├─────────────────────────────────────────────────────────────────────┤
│  ⚠ SYCOPHANCY      Detected in 12% of completions                  │
│    → Agreement rate: 94% (baseline: 71%)                            │
│    [View Examples] [Analyze Prompts]                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Parquet Export

- Export experiment data for analysis in notebooks
- Schema matches what ML researchers expect
- Button: "Export to Parquet" → saves to experiment directory

### Exit Criteria

- [ ] Reward health dashboard shows live training metrics
- [ ] Experiment comparison works for 2+ experiments
- [ ] Config diff highlights changes between runs
- [ ] At least 2 reward hack patterns implemented
- [ ] Parquet export produces valid files

---

## Technical Constraints

### Performance Budgets (Must Maintain)

| Metric | Target |
|--------|--------|
| Binary size | ~15MB |
| Core RAM | ~200-450MB (without language servers) |
| Cold start | < 2-4 seconds |
| Idle CPU | Near 0% (no polling) |

### Lightweight Dependencies

| Need | Solution | Bundle Impact |
|------|----------|---------------|
| Charts | uPlot | +29KB gzipped |
| Database | SQLite | +3MB |
| Parquet export | Go parquet lib | Minimal |
| Real-time | Wails events | 0 (existing) |

### What NOT to Build

| Feature | Reason |
|---------|--------|
| MLflow/W&B adapters | v3.0 scope |
| GPU job monitoring | Needs external infra |
| AI Tutor panel | Adds LLM dependency |
| Preference Data Explorer | Complex, defer |
| Checkpoint diff tool | Nice-to-have |
| Full notebook interface | Out of scope |

---

## Demo Narrative (10 Minutes)

1. **Problem Setup** (1 min)
   > "I'm training a reward model for helpfulness vs harmlessness. Previous runs showed reward hacking."

2. **Launch Experiment** (1 min)
   > Show ML Mode, experiment list, launch training job.

3. **Monitor Training** (2 min)
   > Real-time Reward Signal Health dashboard. "Watch the helpfulness component diverging here."

4. **Investigate Anomaly** (2 min)
   > Click the divergence. Show auto-detected length gaming pattern.

5. **Compare Runs** (2 min)
   > Experiment comparison. "When I added dropout, the divergence disappeared. Here's the config diff."

6. **Export & Analyze** (1 min)
   > Export to Parquet for notebook analysis.

7. **Wrap Up** (1 min)
   > "This compresses a week of debugging into an afternoon. And it's a 15MB binary that works offline."

---

## Success Signals

| Signal | Evidence |
|--------|----------|
| Understands reward model workflows | Reward-specific dashboards, not generic ML |
| Can build research acceleration tools | Comparison matrix, anomaly detection |
| Knows ML Ops patterns | Event sourcing, structured logging |
| Keeps it lightweight | ~15MB binary, SQLite, no server deps |
| Full-stack capability | Go backend + React frontend |
| Quality focus | Polished UI, good performance, clean code |

---

## Appendix: Issue Triage

### Complete (Phase 1A)
- #12, #13, #14, #15, #17

### Defer Indefinitely
- #16, #18, #19, #23, #24, #25, #26, #27, #28, #29, #30, #31, #33

### New Issues to Create
- Panel resizing system
- TypeScript 5.7+ upgrade
- Vite 6.x upgrade
- TreeNode memoization
- Accessibility contrast fixes
- ML Mode switcher
- SQLite integration
- Experiment list panel
- Metrics dashboard
- Reward health panel
- Experiment comparison
- Reward hack detection
- Parquet export

---

*Document version: 1.0*
*Strategy informed by: ml-ops-strategy.md, ui-ux-review-report.md*
