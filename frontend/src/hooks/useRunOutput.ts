import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { useIDEStore } from '../stores/ideStore';
import type { OutputChunk, RunState } from '../types/runOutput';
import { ALL_PROFILES_ID } from '../types/runOutput';

export function useRunOutputListener(): void {
  useEffect(() => {
    const cleanupOutput = EventsOn('run:output', (chunk: OutputChunk) => {
      useIDEStore.getState().appendRunOutput(chunk);
    });

    const cleanupStatus = EventsOn(
      'run:status',
      (status: { profileId: string; state: string; exitCode: number }) => {
        const store = useIDEStore.getState();
        store.setRunState(status.profileId, status.state as RunState, status.exitCode);

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
    };
  }, []);
}
