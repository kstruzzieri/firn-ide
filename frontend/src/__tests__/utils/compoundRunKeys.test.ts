import { parseCompoundStepKey } from '../../utils/compoundRunKeys';

describe('parseCompoundStepKey', () => {
  it('parses compound step output keys', () => {
    expect(parseCompoundStepKey('compound:Y2k:2')).toEqual({ compoundId: 'ci', stepIdx: 2 });
  });

  it('allows separators inside compound IDs', () => {
    expect(parseCompoundStepKey('compound:Y2kjcmVsZWFzZTpwcm9k:3')).toEqual({
      compoundId: 'ci#release:prod',
      stepIdx: 3,
    });
  });

  it('allows unicode inside compound IDs', () => {
    expect(parseCompoundStepKey('compound:Y2kt8J-agA:4')).toEqual({
      compoundId: 'ci-🚀',
      stepIdx: 4,
    });
  });

  it.each([
    '',
    'ci',
    'ci#1',
    'compound',
    'compound:',
    'compound::1',
    'compound:@@@:1',
    'compound:Y2k',
    'compound:Y2k:',
    'compound:Y2k:x',
    'compound:Y2k:-1',
    'compound:Y2k:1:extra',
  ])('rejects %s', (key) => {
    expect(parseCompoundStepKey(key)).toBeNull();
  });
});
