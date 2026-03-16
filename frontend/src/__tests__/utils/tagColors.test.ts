import { getTagColor } from '../../utils/tagColors';

describe('getTagColor', () => {
  it('returns blue tints for dev tag', () => {
    const color = getTagColor('dev');
    expect(color.background).toContain('56,189,248');
    expect(color.text).toContain('56,189,248');
  });
  it('returns purple tints for test tag', () => {
    const color = getTagColor('test');
    expect(color.background).toContain('168,85,247');
  });
  it('returns amber tints for build tag', () => {
    const color = getTagColor('build');
    expect(color.background).toContain('245,158,11');
  });
  it('returns cyan tints for lint tag', () => {
    const color = getTagColor('lint');
    expect(color.background).toContain('6,182,212');
  });
  it('returns red tints for deploy tag', () => {
    const color = getTagColor('deploy');
    expect(color.background).toContain('239,68,68');
  });
  it('returns neutral fallback for unknown tag', () => {
    const color = getTagColor('custom' as string);
    expect(color.background).toBe('rgba(255,255,255,0.04)');
    expect(color.text).toBe('#3a3a3a');
  });
});
