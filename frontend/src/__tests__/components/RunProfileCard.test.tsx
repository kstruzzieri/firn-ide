import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RunProfileCard } from '../../components/RunProfiles/RunProfileCard';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

const mockSetActiveVariant = jest.fn<Promise<void>, [string, string]>();

jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: jest.fn(() => Promise.resolve()),
  StopRunProfile: jest.fn(() => Promise.resolve()),
  RestartRunProfile: jest.fn(() => Promise.resolve()),
  PinRunProfile: jest.fn(() => Promise.resolve()),
  UnpinRunProfile: jest.fn(() => Promise.resolve()),
  SetActiveVariant: (...args: [string, string]) => mockSetActiveVariant(...args),
}));

const profileWithVariants: RunProfile = {
  id: 'web',
  name: 'Web',
  type: 'single',
  source: 'user',
  command: 'npm run dev',
  envVariants: [
    { name: 'dev', envFile: '.env.dev' },
    { name: 'staging', envFile: '.env.staging' },
  ],
  activeVariant: 'dev',
};

const baseProps = {
  visualState: 'idle' as const,
  runOutput: undefined,
  runHistory: [],
  isDormant: true,
  isDuplicate: false,
  onFocusOutput: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSetActiveVariant.mockResolvedValue(undefined);
  useIDEStore.setState({
    runProfiles: [],
    toast: null,
  });
});

describe('RunProfileCard environment variants', () => {
  it('renders active variant selector for profiles with env variants', () => {
    render(<RunProfileCard profile={profileWithVariants} {...baseProps} />);

    const selector = screen.getByLabelText('Web environment variant') as HTMLSelectElement;
    expect(selector.value).toBe('dev');
    expect(screen.getByRole('option', { name: 'base' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'staging' })).toBeInTheDocument();
  });

  it('persists variant selection through the Wails binding and local store', async () => {
    render(<RunProfileCard profile={profileWithVariants} {...baseProps} />);

    fireEvent.change(screen.getByLabelText('Web environment variant'), {
      target: { value: 'staging' },
    });

    await waitFor(() => {
      expect(mockSetActiveVariant).toHaveBeenCalledWith('web', 'staging');
    });
    await waitFor(() => {
      expect(useIDEStore.getState().runProfiles[0].activeVariant).toBe('staging');
    });
  });
});
