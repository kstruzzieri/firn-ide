import { fireEvent, render, screen } from '@testing-library/react';
import { OutputLine } from '../../../components/RunOutput/OutputLine';
import { useIDEStore } from '../../../stores/ideStore';

const mockNavigate = jest.fn();
jest.mock('../../../utils/editorNavigation', () => ({
  navigateToEditorLocation: (...args: unknown[]) => mockNavigate(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState(useIDEStore.getInitialState());
  useIDEStore.setState({ workspace: { name: 'Repo', path: '/repo' } });
});

describe('OutputLine', () => {
  it('renders output without links when no file reference is present', () => {
    render(<OutputLine text="build completed" className="line" />);

    expect(screen.getByText('build completed')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens a referenced file at the parsed line and column', () => {
    render(
      <OutputLine
        text="src/App.tsx:7:11 - error TS2322"
        className="line"
        workingDir="frontend"
        workspacePath="/repo"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open src/App.tsx at line 7, column 11' }));

    expect(mockNavigate).toHaveBeenCalledWith('/repo/frontend/src/App.tsx', 7, 11, {
      shouldApply: expect.any(Function),
    });

    const options = mockNavigate.mock.calls[0][3] as { shouldApply: () => boolean };
    expect(options.shouldApply()).toBe(true);

    useIDEStore.setState({ workspace: { name: 'Other', path: '/other' } });
    expect(options.shouldApply()).toBe(false);
  });

  it('uses the workspace root when the profile working directory is empty', () => {
    render(
      <OutputLine
        text='File "app.py", line 12, in <module>'
        className="line"
        workspacePath="/repo"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open app.py at line 12, column 1' }));

    expect(mockNavigate).toHaveBeenCalledWith('/repo/app.py', 12, 1, {
      shouldApply: expect.any(Function),
    });
  });
});
