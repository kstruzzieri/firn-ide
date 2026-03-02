# gRPC Service Integration — Concept (v2.0+)

> Preserved from the original design specification. This concept describes a future Service Adapter Pattern for integrating Firn IDE with external backends (ML platforms, custom services, etc.) via gRPC and REST adapters.

---

## Architecture

Firn IDE uses a **Service Adapter Pattern** to integrate with any external backend:

```
+--------------------------------------------------+
|                    Firn IDE                        |
|                                                   |
|  Experiments | Training | Models | Backtesting    |
+--------------------------------------------------+
                      |
              ServiceAdapter Interface
                      |
       +--------------+--------------+
       |              |              |
  Custom gRPC     MLflow         W&B
   Adapter       Adapter       Adapter
       |              |              |
  Your Backend    MLflow API    W&B API
```

## Service Adapter Interface

```typescript
interface ServiceAdapter {
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

## Backend Configuration

```
+--------------------------------------------------+
|  Backend Configuration                            |
+--------------------------------------------------+
|                                                   |
|  Backend Type:                                    |
|  [ None | MLflow | W&B | Custom gRPC | Custom REST ]
|                                                   |
|  --- gRPC Configuration ---                       |
|                                                   |
|  Server Address:  [ localhost:50051          ]     |
|  Proto File:      [ /path/to/service.proto  ] [Browse]
|  TLS:             [x] Enable TLS                  |
|  Auth Token:      [ **********************  ]     |
|                                                   |
|  --- Method Mapping ---                           |
|                                                   |
|  listExperiments  -> [ MyService.GetExperiments ] |
|  startTraining    -> [ MyService.Train          ] |
|  getModelMetrics  -> [ MyService.Evaluate       ] |
|  ...                                              |
|                                                   |
|  [ Test Connection ]  [ Save ]  [ Cancel ]        |
+--------------------------------------------------+
```

## Features

1. **Proto file parsing** -- IDE reads `.proto` to discover available methods
2. **Server reflection** -- Alternative: auto-discover methods without proto file
3. **Method mapping** -- Map IDE features to your service's actual method names
4. **Field mapping** -- Configure how response fields map to IDE's expected format
5. **Presets** -- Save configurations (e.g., "Trading Platform Dev", "Production")

## Built-in Adapters (Planned)

| Backend | Type | Target Version |
|---------|------|---------------|
| Standalone | File-based | v2.0 |
| Custom gRPC | gRPC | v2.5 |
| Custom REST | REST API | v2.5 |
| MLflow | REST API | v3.0 |
| Weights & Biases | REST API | v3.0 |

## Implementation Notes

- The adapter interface is intentionally broad to support various use cases
- Initial implementation should focus on the Custom gRPC adapter
- Each adapter is a separate package that implements the ServiceAdapter interface
- Connection configuration stored per-workspace in `.firn/adapters/`
