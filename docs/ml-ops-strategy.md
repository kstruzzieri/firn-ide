# Flux IDE: ML Ops Strategy

**Purpose:** Document architectural decisions and features for Flux IDE's ML Mode.

**Date:** January 31, 2026

---

## Executive Summary

Flux IDE should not be a "better VS Code" - it should demonstrate deep understanding of **reward model development workflows**. Every feature must pass the test: *"Would this help a researcher debug a reward hacking bug faster?"*

**Core Insight:** The goal is to compress weeks of testing into days. This IDE should embody that philosophy in its architecture.

---

## Part 1: Architecture Decisions to Lock In NOW

These decisions become exponentially harder to change as the codebase grows. Implement before Phase 1 completion.

### 1.1 Event Sourcing for Experiment State

**What:** Store all experiment activity as an immutable event log, not snapshots.

**Why Critical:**
- Reward model debugging requires understanding *how* a model evolved
- Event replay enables "time travel debugging" for reward hacking detection
- Enables comparison of experiment trajectories, not just endpoints

**Go Implementation:**
```go
// internal/events/store.go
type ExperimentEvent struct {
    ID          string
    Timestamp   time.Time
    Type        string    // "metric", "config_change", "alert", "checkpoint"
    ExperimentID string
    Data        json.RawMessage
}

type EventStore interface {
    Append(event ExperimentEvent) error
    Replay(experimentID string, from, to time.Time) ([]ExperimentEvent, error)
    Subscribe(filter EventFilter) <-chan ExperimentEvent
}
```

### 1.2 Structured Logging Protocol

**What:** All ML output parsed into queryable structured format.

**Protocol (JSON Lines):**
```json
{"ts": 1706745600, "type": "metric", "step": 1000, "data": {"loss": 0.234, "reward": 0.89}}
{"ts": 1706745601, "type": "comparison", "data": {"pair_id": 42, "chosen": "A", "confidence": 0.95}}
{"ts": 1706745602, "type": "warning", "category": "reward_hack", "data": {"pattern": "length_gaming"}}
```

**Why Now:** If you build raw log viewing first, you'll never get structured logging. Make structured the default.

### 1.3 SQLite for Everything (No External Dependencies)

**Schema Foundation:**
```sql
CREATE TABLE experiments (
    id TEXT PRIMARY KEY,
    name TEXT,
    config JSON,
    parent_id TEXT,  -- For experiment forking/lineage
    status TEXT,
    created_at INTEGER
);

CREATE TABLE metrics (
    experiment_id TEXT,
    step INTEGER,
    name TEXT,
    value REAL,
    timestamp INTEGER,
    PRIMARY KEY (experiment_id, step, name)
);

-- Full-text search on logs
CREATE VIRTUAL TABLE logs USING fts5(
    experiment_id, content, level, category
);

CREATE TABLE reward_signals (
    experiment_id TEXT,
    step INTEGER,
    component TEXT,  -- 'helpfulness', 'harmlessness', 'honesty'
    value REAL,
    distribution JSON  -- histogram data
);
```

**Why SQLite:**
- Zero configuration, works offline
- Single file backup/sync
- Researchers work on planes, trains, without VPN
- ~15MB binary stays lightweight

### 1.4 Perspective Architecture (Code Mode / ML Mode / Eval Mode)

**What:** UI transforms based on active mode, with shared state.

**Modes:**
1. **Code Mode** - Traditional development
2. **ML Mode** - Experiment dashboard, training monitoring
3. **Eval Mode** - Side-by-side model evaluation, reward analysis

**Why Now:** Current IDEShell must be refactored to support multiple layouts before more components are built.

---

## Part 2: "Wow Factor" Features (Priority Order)

### Tier 1: Build These (Key Differentiators)

#### 2.1 Reward Signal Health Dashboard

**What:** Real-time visualization of reward model behavior during training.

**Panels:**
- Distribution plots of reward scores over time
- Correlation analysis between reward components (helpfulness vs harmlessness)
- Anomaly detection for reward hacking patterns
- Side-by-side comparison with baseline runs

**Demo Scenario:**
> "Watch how the helpfulness component starts diverging at epoch 47. Let me drill into the preference pairs that caused this..."

**Training Metrics Dashboard Mockup:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  experiment: reward-model-v3.2   ▼     [Live] ●                    12h 34m  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Loss ─────────────────────────────────────────────────────────────────     │
│  2.4 ┤                                                                      │
│      │    ╭──╮                                                              │
│  1.8 ┤───╯  ╰────╮                                               ▲ LR bump │
│      │           ╰──────────╮                                    │          │
│  1.2 ┤                      ╰────────────────────────────────────╯          │
│      │                                             ╰─────────────────       │
│  0.6 ┤                                                                      │
│      └──────────────────────────────────────────────────────────────────    │
│       0        2k        4k        6k        8k       10k      step         │
│                                                                             │
│  ┌─ Reward Signal ──────────┐  ┌─ KL Divergence ────────┐  ┌─ Gradient ──┐ │
│  │  ▁▂▃▄▅▆▇█▇▆▅▆▇█▇▆▅▆▇    │  │  ▇▆▅▄▃▃▂▂▂▂▂▁▁▁▁▁▁▁▁   │  │  ▂▃▄▃▂▃▄▃▂ │ │
│  │  curr: 0.847  Δ +0.023   │  │  curr: 0.042  target<0.1│  │  norm: 1.23 │ │
│  └──────────────────────────┘  └─────────────────────────┘  └─────────────┘ │
│                                                                             │
│  Annotations ─────────────────────────────────────────────────────────────  │
│  ● step 4200: Switched to new reward model checkpoint                       │
│  ● step 7800: Learning rate increased 2x (manual intervention)              │
│  ⚠ step 9100: Gradient spike detected (auto-flagged)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2 Experiment Comparison Matrix

**What:** Side-by-side comparison of N experiments across M metrics.

**Features:**
- Automatic diff highlighting (what changed between configs)
- Metric trajectories overlaid on same axes
- Statistical significance indicators
- One-click "promote to baseline"

**ASCII Mockup:**
```
+---------------------------+---------------------------+
| exp-v3.2-baseline         | exp-v3.3-new-reward       |
+---------------------------+---------------------------+
| final loss: 0.847         | final loss: 0.721  ▼-14.9%|
| reward (mean): 0.723      | reward (mean): 0.801 ▲+10%|
| KL divergence: 0.089      | KL divergence: 0.112 ⚠    |
+---------------------------+---------------------------+
| Config Diff:                                          |
| - learning_rate: 1e-4 → 5e-5                         |
| - reward_model: v2.1 → v2.3                          |
+-------------------------------------------------------+
```

**Reward Distribution Analysis View:**
```
┌─ REWARD DISTRIBUTION ─────────────────────────────────────────────┐
│ [Model A] vs [Model B] vs [Baseline]                              │
│                                                                   │
│ Model A:  ▁▂▃▅▆▇████▇▆▅▃▂▁   μ=0.42, σ=0.18                      │
│ Model B:  ▁▁▂▃▅▇████████▅▂   μ=0.58, σ=0.21  ⚠️ Right-skewed     │
│ Baseline: ▂▃▄▅▆▆▆▆▅▄▃▂▁▁     μ=0.35, σ=0.12                      │
│                                                                   │
│ [KL Divergence] [Correlation] [Percentiles]                       │
└───────────────────────────────────────────────────────────────────┘
```

#### 2.3 Preference Data Explorer

**What:** Interactive tool for analyzing human preference datasets.

**Features:**
- Browse preference pairs with full context
- Filter by agreement rate, annotator, time period
- Identify controversial examples (high disagreement)
- Link preference pairs to training impact

**Comparison Labeling Interface:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Comparison Labeling                    Progress: 127/500 (25%)   [⚙] [?]   │
├──────────────────────────────────┬──────────────────────────────────────────┤
│  Response A                      │  Response B                              │
│  "In quiet moments, wonder       │  "Discovery feels like morning light    │
│   blooms, A spark ignites..."    │   Breaking through a dusty window..."   │
│  ┌─ Metadata ─────────────────┐  │  ┌─ Metadata ─────────────────┐         │
│  │  tokens: 42  model: v3.2   │  │  │  tokens: 38  model: v3.3   │         │
│  └────────────────────────────┘  │  └────────────────────────────┘         │
├──────────────────────────────────┴──────────────────────────────────────────┤
│  Which response is better?                                                  │
│  [A much better]  [A slightly]  [Tie]  [B slightly]  [B much better]       │
│       ⌘1             ⌘2          ⌘3        ⌘4            ⌘5                │
│  [Skip ⌘S]  [Flag for Review ⌘F]  [Add Note ⌘N]     [◀ Prev]  [Next ▶]     │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.4 Automated Alert System

**What:** Configurable alerts for reward model pathologies.

**Alert Types:**
- Reward hacking patterns (reward up, quality proxy down)
- Training instability (loss NaN, gradient explosion)
- Distribution collapse (reward signal variance approaching zero)
- KL divergence exceeding threshold

#### 2.5 Reward Hack Detection Dashboard

**What:** Built-in detection for common RM pathologies with pattern library.

**ASCII Mockup:**
```
┌─ REWARD HACKS ────────────────────────────────────────────────────┐
│ [Auto-Detect: ON]  [Patterns: 12 loaded]  [Last scan: 2m ago]     │
├───────────────────────────────────────────────────────────────────┤
│ ⚠️ LENGTH_GAMING   Model B shows 0.73 correlation reward↔length  │
│    → Responses 40% longer than Model A for same prompts          │
│    [View Examples] [Compare Lengths] [Ignore Pattern]            │
├───────────────────────────────────────────────────────────────────┤
│ ⚠️ SYCOPHANCY      Detected in 12% of preference completions     │
│    → Agreement rate with user premise: 94% (baseline: 71%)       │
│    [View Examples] [Analyze Prompts]                             │
└───────────────────────────────────────────────────────────────────┘
```

**Detection Patterns:**
- Length gaming (reward correlates with response length)
- Sycophancy (excessive agreement with user premise)
- Reward collapse (variance approaching zero)
- KL divergence drift (policy straying from base model)

#### 2.6 Data Quality Flywheel

**What:** Continuous improvement of preference datasets with quality tracking.

**ASCII Mockup:**
```
┌─ DATA QUALITY ────────────────────────────────────────────────────┐
│ Dataset: preferences_v3                                           │
│                                                                   │
│ ANNOTATOR AGREEMENT                                               │
│ ████████████████░░░░ 82%  (+3% from v2)                          │
│                                                                   │
│ LABEL DISTRIBUTION              FLAGGED SAMPLES                   │
│ A chosen: 54%  ████████████     23 low-confidence pairs          │
│ B chosen: 41%  ████████         12 potential label errors        │
│ Tie:       5%  █                 8 near-duplicates                │
│                                                                   │
│ [Review Flagged] [Re-annotate Sample] [Export Clean Subset]       │
└───────────────────────────────────────────────────────────────────┘
```

**Quality Metrics Tracked:**
- Annotator agreement rate
- Label distribution balance
- Duplicate/near-duplicate rate
- Ambiguous pair count

### Tier 2: Build If Time Permits

#### 2.7 Checkpoint Diff Tool
Compare two model checkpoints: weight diffs, behavior diffs on held-out examples.

#### 2.8 Gradient Flow Visualizer
Per-layer gradient statistics, vanishing/exploding detection.

#### 2.9 AI-Powered Experiment Suggestions
AI analyzes experiment history and suggests next experiments based on patterns.

---

## Part 3: What to Cut/Deprioritize

The current design spec has features that dilute ML Ops focus:

| Feature | Current Priority | Recommendation |
|---------|-----------------|----------------|
| Preview pane (Vite) | Phase 6 | **Cut entirely** - irrelevant to reward model work |
| Frontend workspace | Core | **Deprioritize** - ML researchers rarely write React |
| JetBrains-like Git UI | Phase 4 | **Simplify** - basic Git is fine |
| Debugger (DAP) | Phase 7 | **Defer** - nice but not differentiating |
| Complex context menus | Spec'd in detail | **Simplify** - keyboard-first matters more |

**Redirect this effort toward Tier 1 reward model features.**

---

## Part 4: Lightweight Tech Choices

### Performance Budget Constraints

**Target Metrics (Must Maintain):**
| Metric | Target | Notes |
|--------|--------|-------|
| Binary size | ~15MB | No Electron bloat |
| Core RAM | ~200-450MB | Without language servers |
| Cold start | < 2-4 seconds | Instant feel |
| Idle CPU | Near 0% | No polling, event-driven |

### RAM/CPU Impact Estimates for ML Features

| Feature | RAM Impact | CPU Impact |
|---------|-----------|------------|
| SQLite metrics store | ~5-10MB for typical experiments | Negligible (indexed queries) |
| Live training charts | ~1-2MB per visible chart | <1% when updating at 5s intervals |
| Event sourcing log | ~20-50KB per experiment | Negligible (append-only) |
| Reward distribution histograms | ~500KB for visualization | Calculated on-demand |
| Experiment comparison (4 runs) | ~2-4MB | On-demand diff calculation |

### Avoid (Heavy Dependencies)
- MLflow server (requires separate process, 100s MB)
- Redis/PostgreSQL (server overhead)
- Kubernetes integration (out of scope)
- Heavy charting libraries (Recharts 200KB+, Victory 300KB+)
- NVIDIA SDK (use CLI parsing instead)

### Use Instead
| Need | Solution | Bundle Impact |
|------|----------|---------------|
| Metadata storage | SQLite (Go stdlib-ready) | +3MB |
| Real-time streaming | Wails events (existing) | 0 |
| Charts | uPlot (29KB gzipped) | +29KB |
| Process management | Go os/exec | 0 (stdlib) |
| GPU monitoring | nvidia-smi parsing | 0 |

### Lightweight Implementation Principles

1. **Lazy Loading Everywhere**
   - Directory children loaded on folder expand
   - Metrics fetched on-demand, not preloaded
   - CodeMirror language extensions loaded per file type
   - Experiment details fetched when selected

2. **Streaming Over Buffering**
   - Training logs streamed line-by-line, not buffered
   - Metrics appended to SQLite, not held in memory
   - Charts use windowed data (last N points visible)

3. **Canvas Over SVG**
   - uPlot uses Canvas (handles 100k+ points at 60fps)
   - SVG charts bloat DOM with data volume

4. **Go Backend Processing**
   - Heavy computation (diff, aggregation) in Go
   - Frontend receives pre-computed results
   - Efficient memory management with Go GC

5. **No Background Polling**
   - File watching via fsnotify (event-driven)
   - Training updates via Wails events
   - GPU stats polled only when panel visible

---

## Part 5: Integration Priority

### Essential (Build First-Party)
- **File-based experiment tracking** - `.flux/experiments/` structure
- **Metrics streaming** - Extend Wails events for ML data
- **Config validation** - JSON Schema for hyperparameters

### Optional (Adapter Pattern)
- **W&B/MLflow** - Export-only, push metrics out
- **HuggingFace Hub** - Model/dataset downloading
- **SSH remote execution** - Run on GPU boxes

### Avoid Over-Integration
- Kubernetes (researchers use existing infra)
- Ray/Dask (let researchers use preferred distributed framework)
- Feature stores (overkill for research)

### External Systems Integration Matrix

| System | Integration Level | Priority |
|--------|-------------------|----------|
| **MLflow** | Read adapter (import runs, compare) | Medium |
| **Weights & Biases** | Read adapter (import runs, compare) | Medium |
| **Hugging Face Hub** | Model/dataset download | Medium |
| **TensorBoard** | Local server management, deep links | High |
| **Vast.ai/Lambda** | GPU job submission (future) | Low |

### What NOT to Build

| Feature | Reason to Skip |
|---------|----------------|
| Full notebook interface | Too much scope - use Jupyter integration |
| Custom ML framework | Use PyTorch/JAX - don't reinvent |
| Distributed training orchestration | Defer to Ray/Horovod - just integrate |
| Model serving | Out of scope for research IDE |
| Complex plugin system | Adds maintenance burden - use adapters |

---

## Part 6: Demo Narrative (10 Minutes)

1. **Problem Setup** (1 min)
   > "I'm training a reward model for helpfulness vs harmlessness. Previous runs showed reward hacking."

2. **Launch Experiment** (1 min)
   > Show Run Profile creating a training job, connecting to remote GPU.

3. **Monitor Training** (2 min)
   > Real-time Reward Signal Health Dashboard. Point out: "Watch the helpfulness component diverging here."

4. **Investigate Anomaly** (2 min)
   > Click the divergence. Drill into preference pairs. "These controversial examples are causing overfitting."

5. **Compare Runs** (2 min)
   > Experiment Comparison Matrix. "When I added dropout, the divergence disappeared. Here's the config diff."

6. **Automated Alert** (1 min)
   > "For production, I configured alerts. If this pattern recurs, the team gets notified."

7. **Wrap Up** (1 min)
   > "This compresses a week of debugging into an afternoon."

---

## Part 7: Recommended Phase 0.5 (Before Continuing Phase 1)

Add these foundational pieces before more UI work:

### Backend (Go)
```
internal/
  events/
    store.go       # Event sourcing foundation
    bus.go         # ML event types
  experiment/
    config.go      # Typed experiment config
    runner.go      # Launch interface
  metrics/
    store.go       # SQLite metrics store
    streaming.go   # Real-time ingestion
  reward/
    hacks.go       # Pattern detection
    distribution.go
```

### Frontend (TypeScript)
```typescript
// stores/mlStore.ts
interface MLState {
  experiments: Experiment[];
  activeExperimentId: string | null;
  comparisonExperiments: string[];
  liveMetrics: Map<string, MetricPoint[]>;
  alerts: Alert[];
  rewardDistributions: Map<string, Distribution>;
}
```

### Effort Estimate
- Event sourcing foundation: 4-6 hours
- SQLite metrics schema: 2-3 hours
- Experiment config types: 2-3 hours
- Basic mlStore.ts: 2-3 hours

**Total: ~2 days to lock in architecture before proceeding.**

---

## Part 8: ML Researcher Workflow & Keyboard Shortcuts

### The Core Workflow: Edit → Train → Evaluate → Iterate

**Phase 1: Edit**
- Standard code editing with ML-specific enhancements
- Config file navigation: jump from config key to where it's used in code
- First-class treatment for YAML/JSON config files in file explorer

**Phase 2: Launch Training**
- One-keystroke launch from anywhere in project
- Launch confirmation showing: config diff from last run, estimated resources
- Background launch: training starts, IDE remains responsive

**Phase 3: Monitor**
- Embedded monitoring panel: live stdout/stderr, loss curves, GPU utilization
- Key insight: Researchers shouldn't need to switch to browser for basic monitoring
- Deep link to external tools (TensorBoard, W&B) when needed

**Mission Control Layout:**
```
┌───────────────────────────────────┬─────────────────────────────────────────┐
│  Primary Metrics                  │  Sample Inspector                       │
│  ┌─ Loss ──────────────────────┐  │  ┌─────────────────────────────────┐   │
│  │  ▁▂▃▄▅▆▇████▇▆▅▄▃▂▁▂▃▄▅▆▇█ │  │  │ Prompt: "Explain quantum..."   │   │
│  │  current: 0.847  trend: ▼   │  │  │ Response: "Imagine you have..."│   │
│  └─────────────────────────────┘  │  │ Reward: helpfulness 0.92 ████▓ │   │
│  ┌─ Reward ────────────────────┐  │  │         harmlessness 0.88 ███▓ │   │
│  │  ▁▂▃▄▅▆▇██▇▆▇███▇▆▇████▇██ │  │  └─────────────────────────────────┘   │
│  │  current: 0.891  trend: ▲   │  │  [Prev Sample]  [Next]  [Flag]         │
│  └─────────────────────────────┘  │                                         │
├───────────────────────────────────┼─────────────────────────────────────────┤
│  System Health                    │  Event Log                              │
│  GPU 0  ████████░░ 82%  71°C      │  12:34:21  Checkpoint saved (step 8k)   │
│  GPU 1  ███████░░░ 78%  68°C      │  12:31:45  ⚠ Gradient spike detected    │
│  VRAM   ██████░░░░ 64%            │  12:28:12  LR decay: 5e-5 → 2.3e-5      │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

**Phase 4: Evaluate Results**
- Experiment comparison view: side-by-side metrics from multiple runs
- "Pin" important runs for comparison
- Artifact browser: checkpoints, logs, outputs organized by experiment

**Phase 5: Iterate**
- "Clone Experiment" with modifications
- "Resume from Checkpoint" as first-class action
- Quick hyperparam sweep setup

### ML-Specific Command Palette Commands

**Experiment Management:**
- `Launch Experiment` - Start training with current config
- `Launch Experiment (Debug Mode)` - Reduced batch/steps for testing
- `Launch Sweep` - Start hyperparameter sweep
- `Stop Experiment` - Graceful shutdown with checkpoint
- `View Experiment History` - List recent runs with status

**Environment:**
- `Switch Environment` - Change Python/conda environment
- `Sync Environment` - Install dependencies from config
- `Show Environment Info` - Display versions, CUDA, GPU status

**Monitoring:**
- `Show Training Metrics` - Open/focus monitoring panel
- `Compare Experiments` - Open comparison view
- `Open in TensorBoard` - Launch TensorBoard for current experiment

### Recommended Keyboard Shortcuts

| Action | Shortcut | Rationale |
|--------|----------|-----------|
| Launch Experiment | `Cmd+Shift+R` | Mirrors "Run" in other IDEs |
| Launch Debug Mode | `Cmd+Shift+D` | Quick iteration testing |
| Stop Experiment | `Cmd+Shift+.` | Emergency stop, easy to reach |
| Toggle Monitoring Panel | `Cmd+Shift+M` | Quick access to metrics |
| Switch Environment | `Cmd+Shift+E` | Frequent action |
| Open Command Palette | `Cmd+Shift+P` | Standard convention |
| Focus Terminal | `Cmd+\`` | Quick terminal access |
| Compare Experiments | `Cmd+Shift+C` | Common workflow |

### Environment Management Strategy

**Three-Tier Approach:**
1. **Detection (Passive)** - Auto-detect conda, venv, pyenv, Docker
2. **Switching (Active)** - Per-workspace environment binding
3. **Definition (Integrated)** - First-class support for environment.yaml, requirements.txt

---

## Part 9: Success Metrics

### Developer Experience Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time from code change to training start | < 10 seconds | Instrumented timing |
| Context switches per experiment cycle | < 3 | User observation |
| Keystrokes for common actions | Minimize | Action analysis |
| Time to find specific experiment | < 5 seconds | Search performance |
| Environment setup time for new project | < 2 minutes | Onboarding tracking |

### Quality Signals

| Signal | Evidence |
|--------|----------|
| Understands reward model workflows | Reward-specific dashboards, not generic ML |
| Can build research acceleration tools | Comparison matrix, anomaly detection |
| Knows ML Ops patterns | Experiment tracking, structured logging |
| Keeps it lightweight | ~15MB binary, SQLite, no server deps |
| Full-stack capability | Go backend + React frontend + ML integrations |

---

## Part 10: Visual Design Language for ML Context

### Semantic Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Success/Improving | `#10B981` | Complete experiments, positive trends |
| Warning/Anomaly | `#F59E0B` | Needs attention, flagged items |
| Error/Diverging | `#EF4444` | Failures, concerning metrics |
| Running/Active | `#3B82F6` | In-progress experiments |
| Idle/Queued | `#6B7280` | Inactive items |

### Experiment Colors (auto-assigned)
- Purple `#8B5CF6`, Cyan `#06B6D4`, Orange `#F97316`, Pink `#EC4899`, Lime `#84CC16`, Teal `#14B8A6`

### Typography for Data-Dense Interfaces
- **Primary:** Inter (UI text, labels, navigation)
- **Monospace:** JetBrains Mono (metrics, code, data values)
- **Note:** Slightly smaller than typical web apps (12px minimum) to increase density while maintaining readability

### Data Visualization Principles
- Dark background (`#1F2937`) with light gridlines (`#374151`)
- Lines: 2px stroke with subtle glow for emphasis
- Fill areas: 20% opacity of line color
- Annotations: Contrasting color with connecting line to data point

---

## Part 11: Differentiators from MLflow/W&B

| Feature | MLflow/W&B | Flux IDE |
|---------|------------|----------|
| **Local-First** | Server required | SQLite, works offline |
| **Code Integration** | Separate UI | Inline with editor, click-to-code |
| **Reward Model Focus** | Generic ML | Purpose-built RM panels |
| **Comparison** | Limited | First-class multi-experiment diff |
| **Config Management** | Log parameters | Schema-validated, git-tracked |
| **Reward Hacks** | Manual analysis | Auto-detection with patterns |
| **Data Quality** | External tools | Integrated quality flywheel |
| **Lightweight** | 100s MB | ~15MB binary |
| **Launch Targets** | External orchestration | Built-in SSH/local/script |

### Unique Value Propositions

1. **"Click-to-Code"** - Click any metric/config in ML panel, jump to source code
2. **Reward Hack Pattern Library** - Built-in detection for common RM pathologies
3. **Preference Data Reviewer** - Inline review of preference pairs with model predictions
4. **Config-as-Code** - Experiments are code, not database entries
5. **Instant Comparison** - Drag experiments to compare, no separate analysis step

---

## Summary

**Old Framing:** "A lightweight IDE for ML work"

**New Framing:** "A research acceleration platform specifically designed for reward model development"

Every feature should tie back to this core loop:
```
Define Reward → Train Policy → Evaluate Behavior → Detect Issues → Iterate
```
