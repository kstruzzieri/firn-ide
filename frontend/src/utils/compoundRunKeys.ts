export interface CompoundStepKey {
  compoundId: string;
  stepIdx: number;
}

export function parseCompoundStepKey(key: string): CompoundStepKey | null {
  const prefix = 'compound:';
  if (!key.startsWith(prefix)) return null;

  const rest = key.slice(prefix.length);
  const [encodedId, stepIdxText, extra] = rest.split(':');
  if (!encodedId || !stepIdxText || extra != null) return null;

  let compoundId: string;
  try {
    const base64 = encodedId.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    compoundId = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  if (!compoundId) return null;

  const stepIdx = Number.parseInt(stepIdxText, 10);
  if (!Number.isFinite(stepIdx) || stepIdx < 0 || String(stepIdx) !== stepIdxText) return null;
  return { compoundId, stepIdx };
}
