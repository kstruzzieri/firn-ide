import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { useIDEStore } from '../stores/ideStore';
import type { OutputChunk, CompoundRunEvent, RunStatusEvent } from '../types/runOutput';

export function useRunOutputListener(): void {
  useEffect(() => {
    const entryCounts = new Map<string, number>();

    const waveformInterval = setInterval(() => {
      const store = useIDEStore.getState();
      for (const [profileId, count] of entryCounts) {
        store.updateWaveform(profileId, count);
      }
      entryCounts.clear();
    }, 500);

    const cleanupOutput = EventsOn('run:output', (chunk: OutputChunk) => {
      useIDEStore.getState().appendRunOutput(chunk);
      // Waveform tracks ordinary profiles only; compound step output has a parent.
      if (chunk.parentRunInstanceId == null) {
        entryCounts.set(chunk.profileId, (entryCounts.get(chunk.profileId) ?? 0) + 1);
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
