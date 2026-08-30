/**
 * A context window as a human reads one: 262144 is "256K", 1048576 is "1M",
 * 256000 is "256K". Binary-first at each magnitude — LLM context sizes are
 * powers of two far more often than round decimals — but for K the decimal
 * check runs before the binary one: a value divisible by both (256000 is
 * 250 * 1024 AND 256 * 1000) is a decimal advertisement, and "256K" is what
 * its spec sheet says, never "250K".
 *
 * The exact count stays available wherever this renders, via a title
 * attribute carrying the raw number.
 */
export function formatContextWindow(value: number): string {
  if (value < 1000) return `${value}`;
  if (value % 1048576 === 0) return `${value / 1048576}M`;
  if (value % 1000000 === 0) return `${value / 1000000}M`;
  if (value % 1000 === 0) return `${value / 1000}K`;
  if (value % 1024 === 0) return `${value / 1024}K`;
  return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
}
