import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { useIDEStore } from '../stores/ideStore';
import type { OutputChunk, RunState } from '../types/runOutput';

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
      entryCounts.set(chunk.profileId, (entryCounts.get(chunk.profileId) ?? 0) + 1);
    });

    const cleanupStatus = EventsOn(
      'run:status',
      (status: { profileId: string; state: string; exitCode: number; timestamp?: number }) => {
        const ts = status.timestamp ?? Date.now();
        // Single atomic update — prevents render cascade from multiple set() calls
        useIDEStore
          .getState()
          .handleRunStatus(status.profileId, status.state as RunState, status.exitCode, ts);
      }
    );

    return () => {
      cleanupOutput();
      cleanupStatus();
      clearInterval(waveformInterval);
    };
  }, []);
}
