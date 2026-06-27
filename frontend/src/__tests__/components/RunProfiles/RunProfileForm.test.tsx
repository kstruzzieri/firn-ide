import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunProfileForm } from '../../../components/RunProfiles/RunProfileForm';
import { useIDEStore } from '../../../stores/ideStore';
import {
  SaveRunProfile,
  DeleteRunProfile,
  OpenFolderDialog,
} from '../../../../wailsjs/go/main/App';
import type { RunProfile } from '../../../types/runProfile';
import type { workspace } from '../../../../wailsjs/go/models';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  SaveRunProfile: jest.fn(),
  DeleteRunProfile: jest.fn(),
  OpenFolderDialog: jest.fn(),
}));

const defs = [
  { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
  { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'frontend', accent: 'blue' },
] as workspace.WorkspaceDef[];

const detected: RunProfile = {
  id: 'detected:frontend:dev',
  name: 'npm run dev',
  type: 'single',
  source: 'detected',
  command: 'npm run dev',
  workspaceId: 'frontend',
  workspaceName: 'Frontend',
  workspaceRelDir: 'frontend',
  tags: ['dev'],
};

const rootDetected: RunProfile = {
  id: 'detected:root:go-test',
  name: 'go test',
  type: 'single',
  source: 'detected',
  command: 'go test ./...',
  workspaceId: 'root:go',
  workspaceName: 'Go',
  workspaceRelDir: '',
  tags: ['test'],
};

function seedStore() {
  useIDEStore.setState({
    workspace: { name: 'repo', path: '/repo' },
    workspaces: defs,
    activeWorkspaceId: 'frontend',
    runProfiles: [detected, rootDetected],
  } as Partial<ReturnType<typeof useIDEStore.getState>> as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  seedStore();
  useIDEStore.getState().closeRunProfileForm();
});

it('disables Save until name and command are present', () => {
  render(<RunProfileForm state={{ mode: 'create' }} />);
  const save = screen.getByRole('button', { name: /save/i });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'My Dev' } });
  fireEvent.change(screen.getByLabelText(/^command/i), { target: { value: 'npm run dev' } });
  expect(save).toBeEnabled();
});

it('saves a new profile and closes on a valid result', async () => {
  (SaveRunProfile as jest.Mock).mockResolvedValue({ valid: true, errors: [] });
  useIDEStore.getState().openRunProfileForm({ mode: 'create' });
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'My Dev' } });
  fireEvent.change(screen.getByLabelText(/^command/i), { target: { value: 'npm run dev' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(SaveRunProfile).toHaveBeenCalledTimes(1));
  const saved = (SaveRunProfile as jest.Mock).mock.calls[0][0] as RunProfile;
  expect(saved).toMatchObject({
    name: 'My Dev',
    command: 'npm run dev',
    type: 'single',
    workspaceId: 'frontend',
  });
  expect(saved.id).toBeTruthy();
  await waitFor(() => expect(useIDEStore.getState().runProfileForm).toBeNull());
});

it('renders backend field errors inline and stays open', async () => {
  (SaveRunProfile as jest.Mock).mockResolvedValue({
    valid: false,
    errors: [{ field: 'command', message: 'command is required for single profiles' }],
  });
  useIDEStore.getState().openRunProfileForm({ mode: 'create' });
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
  fireEvent.change(screen.getByLabelText(/^command/i), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByText(/command is required/i)).toBeInTheDocument();
  expect(useIDEStore.getState().runProfileForm).not.toBeNull();
});

it('surfaces backend errors not tied to an inline field (no silent failure)', async () => {
  (SaveRunProfile as jest.Mock).mockResolvedValue({
    valid: false,
    errors: [{ field: 'id', message: 'profile id already exists in another workspace' }],
  });
  useIDEStore.getState().openRunProfileForm({ mode: 'create' });
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Dup' } });
  fireEvent.change(screen.getByLabelText(/^command/i), { target: { value: 'echo hi' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByText(/already exists in another workspace/i)).toBeInTheDocument();
  expect(useIDEStore.getState().runProfileForm).not.toBeNull();
});

it('shows an inline error when the folder picker fails', async () => {
  (OpenFolderDialog as jest.Mock).mockRejectedValue(new Error('dialog unavailable'));
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.click(screen.getByRole('button', { name: /browse/i }));
  expect(await screen.findByText(/dialog unavailable/i)).toBeInTheDocument();
});

it('seeds name/command from a detected command via Start from', () => {
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.change(screen.getByLabelText(/start from/i), {
    target: { value: 'detected:frontend:dev' },
  });
  expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe(
    'Frontend — npm run dev'
  );
  expect((screen.getByLabelText(/^command/i) as HTMLInputElement).value).toBe('npm run dev');
  expect(screen.getByText('dev')).toBeInTheDocument();
});

it('includes root typed detected commands when Project is selected', () => {
  useIDEStore.setState({ activeWorkspaceId: 'project' });
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.change(screen.getByLabelText(/start from/i), {
    target: { value: 'detected:root:go-test' },
  });
  expect((screen.getByLabelText(/^command/i) as HTMLInputElement).value).toBe('go test ./...');
});

it('rejects a Browse pick outside the repo root', async () => {
  (OpenFolderDialog as jest.Mock).mockResolvedValue('/elsewhere/thing');
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.click(screen.getByRole('button', { name: /browse/i }));
  expect(await screen.findByText(/inside the workspace/i)).toBeInTheDocument();
  expect((screen.getByLabelText(/working directory/i) as HTMLInputElement).value).toBe('');
});

it('flags duplicate env keys and disables Save', () => {
  render(<RunProfileForm state={{ mode: 'create' }} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
  fireEvent.change(screen.getByLabelText(/^command/i), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
  fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
  const keys = screen.getAllByLabelText(/env key/i);
  fireEvent.change(keys[0], { target: { value: 'A' } });
  fireEvent.change(keys[1], { target: { value: 'A' } });
  expect(screen.getByText(/duplicate/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
});

it('shows Delete when editing a user profile, hides it when customizing detected', () => {
  const user: RunProfile = { ...detected, id: 'u1', source: 'user' };
  const { rerender } = render(<RunProfileForm state={{ mode: 'edit', profile: user }} />);
  expect(screen.getByRole('button', { name: /delete profile/i })).toBeInTheDocument();

  rerender(<RunProfileForm state={{ mode: 'edit', profile: detected }} />);
  expect(screen.queryByRole('button', { name: /delete profile/i })).not.toBeInTheDocument();
});

it('deletes a user profile after confirm and closes', async () => {
  (DeleteRunProfile as jest.Mock).mockResolvedValue(undefined);
  const user: RunProfile = { ...detected, id: 'u1', source: 'user' };
  useIDEStore.getState().openRunProfileForm({ mode: 'edit', profile: user });
  render(<RunProfileForm state={{ mode: 'edit', profile: user }} />);
  fireEvent.click(screen.getByRole('button', { name: /delete profile/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
  await waitFor(() => expect(DeleteRunProfile).toHaveBeenCalledWith('u1'));
  await waitFor(() => expect(useIDEStore.getState().runProfileForm).toBeNull());
});

it('clears copied tags when customizing detected and command changes before save', () => {
  render(<RunProfileForm state={{ mode: 'edit', profile: detected }} />);
  expect(screen.getByText('dev')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^command/i), { target: { value: 'npm run start' } });
  expect(screen.queryByText('dev')).not.toBeInTheDocument();
});

it('preserves saved-user tags when command changes', async () => {
  (SaveRunProfile as jest.Mock).mockResolvedValue({ valid: true, errors: [] });
  const user: RunProfile = { ...detected, id: 'u1', source: 'user', tags: ['dev'] };
  render(<RunProfileForm state={{ mode: 'edit', profile: user }} />);
  fireEvent.change(screen.getByLabelText(/^command/i), { target: { value: 'npm run start' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(SaveRunProfile).toHaveBeenCalledTimes(1));
  const saved = (SaveRunProfile as jest.Mock).mock.calls[0][0] as RunProfile;
  expect(saved.tags).toEqual(['dev']);
});
