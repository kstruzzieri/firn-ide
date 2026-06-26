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
  StopRunProfile(id).catch((err: unknown) => {
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
