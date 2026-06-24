import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RunProfileCard } from '../../components/RunProfiles/RunProfileCard';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

const mockSetActiveVariant = jest.fn<Promise<void>, [string, string]>();
const mockAdoptRunProfile = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const mockUnadoptRunProfile = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: jest.fn(() => Promise.resolve()),
  StopRunProfile: jest.fn(() => Promise.resolve()),
  RestartRunProfile: jest.fn(() => Promise.resolve()),
  PinRunProfile: jest.fn(() => Promise.resolve()),
  UnpinRunProfile: jest.fn(() => Promise.resolve()),
  SetActiveVariant: (...args: [string, string]) => mockSetActiveVariant(...args),
  AdoptRunProfile: (...args: [string]) => mockAdoptRunProfile(...args),
  UnadoptRunProfile: (...args: [string]) => mockUnadoptRunProfile(...args),
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

const detectedProfile: RunProfile = {
  id: 'lint',
  name: 'Lint',
  type: 'single',
  source: 'detected',
  command: 'npm run lint',
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
  mockAdoptRunProfile.mockResolvedValue(undefined);
  mockUnadoptRunProfile.mockResolvedValue(undefined);
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

describe('RunProfileCard adopt control', () => {
  it('shows adopt button for a recent/detected profile and calls AdoptRunProfile', async () => {
    render(
      <RunProfileCard profile={detectedProfile} {...baseProps} isDormant={false} section="recent" />
    );

    const adoptBtn = screen.getByRole('button', { name: /adopt lint/i });
    expect(adoptBtn).toBeInTheDocument();

    fireEvent.click(adoptBtn);

    await waitFor(() => {
      expect(mockAdoptRunProfile).toHaveBeenCalledWith('lint');
    });
  });

  it('does not show adopt button when section is undefined', () => {
    render(<RunProfileCard profile={detectedProfile} {...baseProps} isDormant={false} />);

    expect(screen.queryByRole('button', { name: /adopt lint/i })).not.toBeInTheDocument();
  });

  it('applies just-ran class when isFreshestRun is true', () => {
    const { container } = render(
      <RunProfileCard profile={detectedProfile} {...baseProps} isFreshestRun={true} />
    );

    expect(container.querySelector('[class*="justRan"]')).not.toBeNull();
  });
});
