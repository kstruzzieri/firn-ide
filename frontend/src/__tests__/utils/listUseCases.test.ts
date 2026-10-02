import { listUseCases } from '../../utils/listUseCases';

// One grammar for the editor's notices, the routing rows and the Apply bar.
describe('listUseCases', () => {
  it.each([
    [[], ''],
    [['chat'], 'chat'],
    [['chat', 'completion'], 'chat and completion'],
    [['agent', 'chat', 'completion'], 'agent, chat and completion'],
  ])('%j → %s', (useCases, expected) => {
    expect(listUseCases(useCases)).toBe(expected);
  });
});
