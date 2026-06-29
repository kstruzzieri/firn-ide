import { StartRunProfile, StopRunProfile, RestartRunProfile } from '../../wailsjs/go/main/App';
import { useIDEStore } from '../stores/ideStore';

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function startProfile(id: string, name: string): void {
  StartRunProfile(id).catch((err: unknown) => {
    useIDEStore.getState().showToast(`Failed to start "${name}": ${msg(err)}`, 'error');
  });
}

export function stopProfile(id: string, name: string): void {
  const store = useIDEStore.getState();
  store.setProfileStopping(id);
  // StopRunProfile resolves only after the backend has fully stopped the run
  // (it blocks on process cleanup), or immediately when nothing was running
  // since Stop is an idempotent no-op. Clear the optimistic flag on resolution
  // so an idle/no-op stop cannot leave the spinner stuck — in that case no
  // terminal run:status would arrive to clear it. The terminal status clears
  // the same flag too; both are idempotent.
  StopRunProfile(id)
    .then(() => useIDEStore.getState().clearProfileStopping(id))
    .catch((err: unknown) => {
      useIDEStore.getState().clearProfileStopping(id);
      useIDEStore.getState().showToast(`Failed to stop "${name}": ${msg(err)}`, 'error');
    });
}

export function restartProfile(id: string, name: string): void {
  const store = useIDEStore.getState();
  store.setProfileRestarting(id);
  RestartRunProfile(id).catch((err: unknown) => {
    useIDEStore.getState().clearProfileRestarting(id);
    useIDEStore.getState().showToast(`Failed to restart "${name}": ${msg(err)}`, 'error');
  });
}
