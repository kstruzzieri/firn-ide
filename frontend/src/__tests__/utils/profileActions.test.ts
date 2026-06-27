const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockRestart = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: (...a: unknown[]) => mockStart(...a),
  StopRunProfile: (...a: unknown[]) => mockStop(...a),
  RestartRunProfile: (...a: unknown[]) => mockRestart(...a),
}));

import { startProfile, stopProfile, restartProfile } from '../../utils/profileActions';
import { useIDEStore } from '../../stores/ideStore';

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({ stoppingProfileIds: [], restartingProfileIds: [] });
});

test('startProfile calls the binding', () => {
  startProfile('p1', 'Dev');
  expect(mockStart).toHaveBeenCalledWith('p1');
});

test('stopProfile flags stopping then calls the binding', () => {
  stopProfile('p1', 'Dev');
  expect(useIDEStore.getState().stoppingProfileIds).toContain('p1');
  expect(mockStop).toHaveBeenCalledWith('p1');
});

test('restartProfile flags restarting then calls the binding', () => {
  restartProfile('p1', 'Dev');
  expect(useIDEStore.getState().restartingProfileIds).toContain('p1');
  expect(mockRestart).toHaveBeenCalledWith('p1');
});
