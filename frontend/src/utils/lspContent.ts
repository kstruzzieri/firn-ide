export interface LSPMarkupContent {
  kind: 'markdown' | 'plaintext';
  value: string;
}

export function decodeLSPContent(raw: number[] | undefined): LSPMarkupContent | null {
  if (!raw || raw.length === 0) return null;

  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(raw));
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed === 'string') {
    return { kind: 'plaintext', value: parsed };
  }

  if (Array.isArray(parsed)) {
    const parts = parsed.map((item) => formatMarkedString(item));
    const joined = parts.join('\n\n');
    return joined ? { kind: 'markdown', value: joined } : null;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.kind === 'string' && typeof obj.value === 'string') {
      return {
        kind: obj.kind === 'plaintext' ? 'plaintext' : 'markdown',
        value: obj.value,
      };
    }
    if (typeof obj.language === 'string' && typeof obj.value === 'string') {
      return { kind: 'markdown', value: `\`\`\`${obj.language}\n${obj.value}\n\`\`\`` };
    }
  }

  return null;
}

function formatMarkedString(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    if (typeof obj.language === 'string' && typeof obj.value === 'string') {
      return `\`\`\`${obj.language}\n${obj.value}\n\`\`\``;
    }
  }
  return '';
}
