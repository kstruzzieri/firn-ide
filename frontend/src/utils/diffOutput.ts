const DIFF_SIZE_LIMIT = 5000;

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed' | 'too-large';
  text: string;
}

export function diffOutputLines(prev: string[], curr: string[]): DiffLine[] {
  if (prev.length === 0 && curr.length === 0) return [];

  if (prev.length > DIFF_SIZE_LIMIT && curr.length > DIFF_SIZE_LIMIT) {
    return [{ type: 'too-large', text: '' }];
  }

  if (prev.length === 0) {
    return curr.map((text) => ({ type: 'added' as const, text }));
  }

  if (curr.length === 0) {
    return prev.map((text) => ({ type: 'removed' as const, text }));
  }

  const m = prev.length;
  const n = curr.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (prev[i - 1] === curr[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && prev[i - 1] === curr[j - 1]) {
      result.push({ type: 'unchanged', text: prev[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', text: curr[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', text: prev[i - 1] });
      i--;
    }
  }

  return result.reverse();
}
