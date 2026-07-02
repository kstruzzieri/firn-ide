import { LineAssembler } from './lineAssembler';
import type { OutputEntry } from '../types/runOutput';

function makeAssembler(): { assembler: LineAssembler; entries: OutputEntry[] } {
  const entries: OutputEntry[] = [];
  const assembler = new LineAssembler((entry) => entries.push(entry));
  return { assembler, entries };
}

describe('LineAssembler', () => {
  it('splits a complete line', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'hello\n', 1000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ stream: 'stdout', text: 'hello', timestamp: 1000 });
  });

  it('splits multiple lines in one chunk', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'line1\nline2\nline3\n', 2000);
    expect(entries).toHaveLength(3);
    expect(entries[0].text).toBe('line1');
    expect(entries[1].text).toBe('line2');
    expect(entries[2].text).toBe('line3');
  });

  it('carries over partial lines', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'hel', 1000);
    expect(entries).toHaveLength(0);
    assembler.push('stdout', 'lo\n', 1001);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('hello');
    expect(entries[0].timestamp).toBe(1000);
  });

  it('handles separate streams independently', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'out partial', 1000);
    assembler.push('stderr', 'err partial', 2000);
    assembler.push('stdout', ' done\n', 1001);
    assembler.push('stderr', ' done\n', 2001);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ stream: 'stdout', text: 'out partial done', timestamp: 1000 });
    expect(entries[1]).toEqual({ stream: 'stderr', text: 'err partial done', timestamp: 2000 });
  });

  it('flush emits remaining carry as final entry', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'no newline', 3000);
    expect(entries).toHaveLength(0);
    assembler.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ stream: 'stdout', text: 'no newline', timestamp: 3000 });
  });

  it('flush is a no-op when carry is empty', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'complete\n', 1000);
    assembler.flush();
    expect(entries).toHaveLength(1);
  });

  it('handles empty chunks', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', '', 1000);
    assembler.push('stdout', 'line\n', 1001);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('line');
  });

  it('handles \\r\\n line endings', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'windows\r\nline\r\n', 1000);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('windows');
    expect(entries[1].text).toBe('line');
  });

  it('handles lone \\r as part of line', () => {
    const { assembler, entries } = makeAssembler();
    assembler.push('stdout', 'progress\r', 1000);
    expect(entries).toHaveLength(0);
    assembler.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('progress\r');
  });
});
