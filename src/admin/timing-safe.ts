/**
 * Constant-time byte-array comparison.
 *
 * Single implementation shared by password verification (auth/passwords.ts),
 * CSRF token matching (auth/csrf.ts), and incoming-webhook token checks
 * (public-api.ts) — three copies of security-critical code were a drift risk
 * (Q-2, Aug 2026 quality audit).
 *
 * Runs for max(a.length, b.length) iterations regardless of content and
 * captures a length difference in the initial XOR — no early returns.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result === 0;
}
