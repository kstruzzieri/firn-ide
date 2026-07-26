import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { useIDEStore } from '../stores/ideStore';
import type { OutputChunk, CompoundRunEvent, RunStatusEvent } from '../types/runOutput';

export function useRunOutputListener(): void {
  useEffect(() => {
    const entryCounts = new Map<number, Map<string, number>>();

    const waveformInterval = setInterval(() => {
      const store = useIDEStore.getState();
      if (!store.runEventsPaused) {
        for (const [profileId, count] of entryCounts.get(store.workspaceEpoch) ?? []) {
          store.updateWaveform(profileId, count);
        }
      }
      entryCounts.clear();
    }, 500);

    const cleanupOutput = EventsOn('run:output', (chunk: OutputChunk) => {
      const store = useIDEStore.getState();
      const accepted = store.appendRunOutput(chunk);
      // Waveform tracks ordinary profiles only; compound step output has a parent.
      if (accepted && chunk.parentRunInstanceId == null) {
        const workspaceEpoch = chunk.workspaceEpoch ?? store.workspaceEpoch;
        const epochCounts = entryCounts.get(workspaceEpoch) ?? new Map<string, number>();
        epochCounts.set(chunk.profileId, (epochCounts.get(chunk.profileId) ?? 0) + 1);
        entryCounts.set(workspaceEpoch, epochCounts);
      }
    });

    const cleanupStatus = EventsOn('run:status', (status: RunStatusEvent) => {
      useIDEStore.getState().handleRunStatus(status);
    });

    const cleanupCompound = EventsOn('run:compound', (event: CompoundRunEvent) => {
      useIDEStore.getState().handleCompoundRun(event);
    });

    return () => {
      cleanupOutput();
      cleanupStatus();
      cleanupCompound();
      clearInterval(waveformInterval);
    };
  }, []);
}
