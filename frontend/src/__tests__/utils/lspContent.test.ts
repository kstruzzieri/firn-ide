import { decodeLSPContent } from '../../utils/lspContent';

/** Convert a string to a UTF-8 byte array (number[]) using Node's Buffer. */
function toBytes(s: string): number[] {
  return Array.from(Buffer.from(s, 'utf-8'));
}

describe('decodeLSPContent', () => {
  it('returns null for undefined input', () => {
    expect(decodeLSPContent(undefined)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(decodeLSPContent([])).toBeNull();
  });

  it('decodes a plain string', () => {
    const bytes = toBytes('"hello world"');
    const result = decodeLSPContent(bytes);
    expect(result).toEqual({ kind: 'plaintext', value: 'hello world' });
  });

  it('decodes a MarkupContent object', () => {
    const obj = { kind: 'markdown', value: '**bold**' };
    const bytes = toBytes(JSON.stringify(obj));
    const result = decodeLSPContent(bytes);
    expect(result).toEqual({ kind: 'markdown', value: '**bold**' });
  });

  it('decodes a single MarkedString with language', () => {
    const obj = { language: 'typescript', value: 'const x = 1' };
    const bytes = toBytes(JSON.stringify(obj));
    const result = decodeLSPContent(bytes);
    expect(result).toEqual({ kind: 'markdown', value: '```typescript\nconst x = 1\n```' });
  });

  it('decodes an array of MarkedStrings', () => {
    const arr = [{ language: 'ts', value: 'type Foo = {}' }, 'Some documentation text'];
    const bytes = toBytes(JSON.stringify(arr));
    const result = decodeLSPContent(bytes);
    expect(result).toEqual({
      kind: 'markdown',
      value: '```ts\ntype Foo = {}\n```\n\nSome documentation text',
    });
  });

  it('handles MarkupContent with plaintext kind', () => {
    const obj = { kind: 'plaintext', value: 'just text' };
    const bytes = toBytes(JSON.stringify(obj));
    const result = decodeLSPContent(bytes);
    expect(result).toEqual({ kind: 'plaintext', value: 'just text' });
  });

  it('returns null for malformed JSON', () => {
    const bytes = toBytes('not valid json{');
    expect(decodeLSPContent(bytes)).toBeNull();
  });
});
