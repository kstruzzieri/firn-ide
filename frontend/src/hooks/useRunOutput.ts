import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { useIDEStore } from '../stores/ideStore';
import type { OutputChunk, RunHistoryEntry, RunState } from '../types/runOutput';
import { ALL_PROFILES_ID } from '../types/runOutput';

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
        const store = useIDEStore.getState();
        const ts = status.timestamp ?? Date.now();

        // Clear optimistic lifecycle flags on terminal states
        if (['stopped', 'failed', 'success'].includes(status.state)) {
          store.clearProfileStopping(status.profileId);
          store.clearProfileRestarting(status.profileId);

          // Append run history entry with duration
          const startTs = store.runStartTimestamps[status.profileId];
          if (startTs) {
            store.appendRunHistory(status.profileId, {
              state: status.state as RunHistoryEntry['state'],
              duration: ts - startTs,
              timestamp: ts,
            });
          }
        }

        if (status.state === 'running') {
          store.clearProfileRestarting(status.profileId);
          // Record start timestamp for duration tracking
          useIDEStore.setState((prev) => ({
            runStartTimestamps: { ...prev.runStartTimestamps, [status.profileId]: ts },
          }));
        }

        // Existing behavior: set run state
        store.setRunState(status.profileId, status.state as RunState, status.exitCode);

        // Existing behavior: auto-select first running profile
        if (
          status.state === 'running' &&
          (!store.activeRunOutputId || store.activeRunOutputId === ALL_PROFILES_ID)
        ) {
          store.setActiveRunOutput(status.profileId);
        }
      }
    );

    return () => {
      cleanupOutput();
      cleanupStatus();
      clearInterval(waveformInterval);
    };
  }, []);
}
