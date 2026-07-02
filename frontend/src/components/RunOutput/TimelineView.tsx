import { useMemo } from 'react';
import type { RunOutput } from '../../types/runOutput';
import { SourceTimelineView, type TimelineSource } from './SourceTimelineView';

interface TimelineViewProps {
  runOutputs: Record<string, RunOutput>;
  autoScroll: boolean;
  workspacePath?: string;
}

export function TimelineView({ runOutputs, autoScroll, workspacePath }: TimelineViewProps) {
  const sources: TimelineSource[] = useMemo(
    () =>
      Object.keys(runOutputs).map((key) => {
        const output = runOutputs[key];
        return {
          id: output.profileId,
          label: output.profileId,
          workingDir: output.workingDir,
          entries: output.entries,
        };
      }),
    [runOutputs]
  );

  return (
    <SourceTimelineView
      sources={sources}
      autoScroll={autoScroll}
      workspacePath={workspacePath}
      emptyMessage="No output from any profile"
    />
  );
}
