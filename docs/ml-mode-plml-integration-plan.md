# Flux IDE: ML Mode & PL-ML Integration Plan

*Document created from conversation on January 30-31, 2026*
*Last updated: January 30, 2026*

---

## Executive Summary

This document outlines the complete plan for Flux IDE's ML Mode and its integration with People Learning ML (PL-ML). The approach combines a professional ML experimentation environment with educational components to create a unique, beginner-friendly ML development experience.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Decision: Hybrid Approach](#2-architecture-decision-hybrid-approach)
3. [Related Projects](#3-related-projects)
4. [ML Mode Specification](#4-ml-mode-specification)
5. [PL-ML Integration Strategy](#5-pl-ml-integration-strategy)
6. [Phased Roadmap](#6-phased-roadmap)
7. [Technical Implementation](#7-technical-implementation)

---

## 1. Project Overview

### The Vision

Flux IDE will have two distinct modes that share a unified codebase and design system:

| Mode | Purpose | Primary Use |
|------|---------|-------------|
| **Code Mode** | Traditional IDE for software development | Writing code, Git, run profiles |
| **ML Mode** | ML experimentation and learning environment | Training models, backtesting, understanding ML |

Switching between modes changes the entire interface layout, like switching perspectives in Eclipse/JetBrains IDEs.

### Design Philosophy

- **Editor-centric in Code Mode, Dashboard-centric in ML Mode**
- **Keyboard-first** — Every action accessible via keyboard
- **Lightweight** — No Electron bloat (Wails + system webview)
- **Beginner-friendly** — AI Tutor explains concepts as you work
- **Educational integration** — Learn ML concepts in context

---

## 2. Architecture Decision: Hybrid Approach

### Decision Made

**Path C: Hybrid — ML Mode as a "Perspective"** was chosen over:
- Path A: ML-First IDE (too complex for v1)
- Path B: Separate ML Learning App (context switching friction)

### Rationale

1. **One app, two purpose-built modes** — Each mode is optimized for its use case
2. **Shared infrastructure** — Theme, AI integration, file system access
3. **Portfolio demonstration** — Shows range without maintaining two apps
4. **Learning in context** — Educational content appears where relevant

### Key Characteristics

| Code Mode | ML Mode |
|-----------|---------|
| Editor is primary workspace | Dashboard is primary workspace |
| File tree navigation | Experiment list navigation |
| Run Profiles for build/test | Run Profiles for training jobs |
| AI Chat for coding help | AI Tutor for ML explanations |
| Workspace = code folder | Workspace = ML project/experiment |

---

## 3. Related Projects

### 3.1 Flux IDE (this project)

**Location:** `/Users/keithstruzzieri/projects/claude/flux-ide`

**Purpose:** Lightweight, workspace-focused IDE for macOS and Linux

**Tech Stack:** Wails (Go + React/Vite)

### 3.2 People Learning ML (PL-ML)

**Location:** `/Users/keithstruzzieri/projects/educational/pl-ml`

**Purpose:** Educational ML application with interactive visualizations

**Components:**
- **RAG-Smith** (implemented) — Interactive sandbox teaching RAG concepts
- **ML Academy** (planned) — 7-module ML course platform

**Tech Stack:** React + TypeScript + Vite + Go backend

---

## 4. ML Mode Specification

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Header: Flux ML]  [Workspace ▾]  [Backend: Connected ●]  [⚙]       │
├─────────────────────────────────────────────────────────────────────┤
│ [Experiments] │ [Experiment Detail / Backtest]      │ [AI Tutor]    │
│               │                                     │               │
│ ● run-v3      │ ┌─ Metrics ─────────────────────┐  │ 🤖 Claude     │
│   running     │ │ Sharpe: 1.94  Win: 62%        │  │               │
│ ✓ run-v2      │ │ Drawdown: -8.2%               │  │ Your model    │
│   completed   │ └───────────────────────────────┘  │ shows signs   │
│ ✗ run-v1      │                                     │ of overfit... │
│   failed      │ ┌─ Equity Curve ────────────────┐  │               │
│               │ │ [Chart]                       │  │ [Explain]     │
│ ──────────── │ └───────────────────────────────┘  │ [Fix It]      │
│ + New Run     │                                     │               │
│               │ ┌─ Feature Importance ──────────┐  │               │
│               │ │ [SHAP Summary]                │  │               │
│               │ └───────────────────────────────┘  │               │
├───────────────┴─────────────────────────────────────┴───────────────┤
│ [Data Preview] [GPU Jobs] [Training Logs]                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Panel Specifications

#### Experiments Panel (Left)

Lists all experiments/training runs with:
- Status indicators: `●` Running, `✓` Completed, `✗` Failed, `○` Queued
- Key metrics at a glance (Sharpe, win rate, drawdown)
- Comparison to baseline
- Filters by model type, symbol, date range

#### Experiment Detail Panel (Center)

- **Metrics Card** — Key performance metrics with delta vs baseline
- **Equity Curve** — Portfolio value over time with benchmark comparison
- **Feature Importance** — SHAP summary bar chart
- **Trade Log** — Scrollable list of trades with P&L

#### AI Tutor Panel (Right)

Context-aware ML assistance:
- Sees current experiment data, metrics, config
- Explains ML concepts in beginner-friendly terms
- Suggests hyperparameter changes
- Can generate code fixes
- Links to relevant documentation/tutorials
- Quick actions: [Explain], [Fix It], [Try Different Model]

#### Bottom Panels

- **Data Preview** — Dataset inspection with statistics, charts, correlations
- **GPU Jobs** — Monitor Vast.ai GPU cluster, job queue, costs
- **Training Logs** — Real-time training output with log level filtering

### 4.3 Keyboard Shortcuts (ML Mode)

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

## 5. PL-ML Integration Strategy

### 5.1 Shared Elements

| Element | PL-ML Current | Flux IDE | Integration Approach |
|---------|---------------|----------|----------------------|
| **Color theme** | Dark + neon (cyan/magenta) | Deep Ocean + workspace accents | PL-ML adopts Deep Ocean base, keeps accent highlights |
| **Typography** | Outfit + JetBrains Mono | Geist + JetBrains Mono | Standardize on Geist + JetBrains Mono |
| **Animated backgrounds** | Neural network particles | None | Optional subtle version in ML Mode |
| **Interactive sliders** | Chunk size, overlap, threshold | Run profiles env toggle | Shared slider component |
| **Vector visualization** | 2D embedding scatter plot | None | Add to ML Mode for embeddings |

### 5.2 Educational Integration

PL-ML becomes "Learn" modules within Flux IDE's ML Mode:

```
┌─ ML MODE ──────────────────────────────────────────────────────────┐
│                                                                    │
│  [Experiments] [Models] [Backtest] [Learn ▾]                       │
│                                    ├─ What is RAG?                 │
│                                    ├─ Understanding Embeddings     │
│                                    ├─ Cosine Similarity Explained  │
│                                    └─ Feature Importance (SHAP)    │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 5.3 Concrete Integrations

**1. Embedding Visualizer (from RAG-Smith)**
- Show model's feature embeddings in 2D space
- Interactive: click points to see data samples
- Helps understand prediction clustering

**2. Chunking Explainer (from RAG-Smith)**
- Visualize text chunking for prompt engineering
- Useful when working with AI Chat contexts

**3. Similarity Threshold Slider**
- Apply to model comparison: "show models with Sharpe > 1.5"
- Apply to backtest filtering: "trades with confidence > 0.7"

**4. Interactive ML Tutorials**
- ML Academy modules in "Learn" dropdown
- Context-aware: offer to explain confusion matrices when viewing one
- AI Tutor links to relevant lessons

### 5.4 RAG-Smith Features

**Currently Implemented:**
- Chunking Laboratory — Visual text chunking manipulation
- Retrieval Radar — 2D vector space visualization
- Search Results Carousel — Similarity-scored results
- Neural network animated background
- Dark theme with neon accents

**Integration Plan:**
- Extract vector visualization component
- Adapt to show SHAP/feature importance data
- Use same interaction patterns (sliders, hover tooltips)

### 5.5 ML Academy Features (Planned)

**Module 1 Visualizations (for smaller demo):**
1. Pattern Finder — Identifying linear relationships
2. Overfitting visualization — Complexity slider showing train/val divergence
3. Train/Validation/Test split — Interactive data partitioning

**Future Modules:**
- Supervised Learning, Unsupervised Learning, Neural Networks
- Progress tracking with localStorage persistence

---

## 6. Phased Roadmap

### v1.0 — Code Mode
- Full IDE shell with workspaces, run profiles, search
- File explorer, editor, terminal
- Git integration
- Theme and visual identity

### v1.5 — AI Chat Panel
- Claude integration (primary provider)
- Context-aware assistance (current file, workspace)
- Code application with diff preview
- Provider architecture ready for multi-provider

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
- **PL-ML educational modules in "Learn" dropdown**

### v3.0 — Advanced ML Integration
- Data preview panel
- GPU job monitoring (Vast.ai)
- MLflow adapter
- Weights & Biases adapter
- Model comparison view
- Full ML Academy integration

---

## 7. Technical Implementation

### 7.1 ML Service Adapter Pattern

Flux IDE uses a Service Adapter Pattern to integrate with any ML backend:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Flux IDE                                                            │
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
│           │ (Your app)   │    │ (REST API)   │    │ Adapter     │ │
│           └──────────────┘    └──────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Service Adapter Interface

```typescript
interface MLServiceAdapter {
  // Connection
  connect(config: ConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Experiments
  listExperiments(filter?: ExperimentFilter): Promise<Experiment[]>
  getExperiment(id: string): Promise<ExperimentDetail>
  createExperiment(config: ExperimentConfig): Promise<Experiment>

  // Training
  startTraining(config: TrainingConfig): Promise<TrainingJob>
  stopTraining(jobId: string): Promise<void>
  getTrainingStatus(jobId: string): Promise<TrainingStatus>
  streamTrainingProgress(jobId: string): AsyncIterable<ProgressUpdate>

  // Models
  listModels(filter?: ModelFilter): Promise<Model[]>
  getModelMetrics(modelId: string): Promise<ModelMetrics>
  getFeatureImportance(modelId: string): Promise<FeatureImportance>

  // Backtesting
  runBacktest(config: BacktestConfig): Promise<BacktestResult>
  getBacktestDetail(id: string): Promise<BacktestDetail>

  // Data
  listDatasets(): Promise<Dataset[]>
  previewDataset(id: string, limit?: number): Promise<DataPreview>

  // GPU (optional)
  getGPUStatus?(): Promise<GPUStatus[]>
  getGPUJobs?(): Promise<GPUJob[]>
}
```

### 7.3 Backend Configuration

The IDE will support connecting to:
- **None** (standalone mode, file-based tracking)
- **Custom gRPC Service**
- **Custom REST API**
- **MLflow** (v3.0)
- **Weights & Biases** (v3.0)

### 7.4 Design System Unification

**Shared Design Tokens:**
```css
:root {
  /* Deep Ocean Base (shared) */
  --surface-base: #1A2530;
  --surface-frame: #0F1A22;
  --surface-panel: #0A1218;
  --surface-elevated: #06101A;

  /* Text */
  --text-primary: #E6EDF3;
  --text-secondary: #8B9CAE;
  --text-muted: #5A7080;

  /* ML Mode Accent (cyan) */
  --accent-ml: #06B6D4;
  --accent-ml-dim: rgba(6, 182, 212, 0.12);

  /* Code Mode Accent (blue) */
  --accent-code: #3B82F6;
  --accent-code-dim: rgba(59, 130, 246, 0.12);
}
```

---

## Appendix: Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ML integration approach | Hybrid (ML Mode perspective) | One app, two purpose-built UIs |
| PL-ML relationship | Educational modules in ML Mode | Context-aware learning, no app switching |
| Design unification | PL-ML adopts Deep Ocean theme | Consistent brand, keep accent highlights |
| Initial scope | Smaller demo (2-3 visualizations) | Build foundation, expand iteratively |
| Development priority | Flux mockups first, then PL-ML | Complete IDE vision before implementation |
| ML backend integration | Service Adapter Pattern | Supports multiple backends (gRPC, REST, MLflow) |

---

*Document version: 1.0*
*Created from conversation session: ecededb6-cd57-4aba-804e-f1cf90c6e660*
