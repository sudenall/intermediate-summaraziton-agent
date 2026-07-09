// Intermediate summarization / context compression.
//
// When the combined output of the upstream agents (search + retrieval) would
// blow past the synthesis agent's effective context budget, we route it
// through a simulated summarization pass first. The summarization itself is
// not a real model call — it is a deterministic-ish token reduction within a
// realistic compression band — but it is gated behind the same
// callAgent("summarization", ...) path as every other agent, so it still
// carries latency and can still fail and be retried.

export const DEFAULT_CONTEXT_BUDGET_TOKENS = 6000;

// A real summarizer rarely hits an exact ratio; model the output as falling
// somewhere in a band rather than a fixed fraction.
const MIN_COMPRESSION_RATIO = 0.22; // most aggressive: keep 22% of tokens
const MAX_COMPRESSION_RATIO = 0.38; // least aggressive: keep 38% of tokens

/**
 * Decide whether combined upstream output needs compression, and if so,
 * compute the simulated post-compression token count.
 *
 * @param {number} combinedTokens
 * @param {number} budgetTokens
 * @returns {{needed: boolean, outputTokens: number, ratio: number|null}}
 */
export function planCompression(combinedTokens, budgetTokens = DEFAULT_CONTEXT_BUDGET_TOKENS) {
  if (combinedTokens <= budgetTokens) {
    return { needed: false, outputTokens: combinedTokens, ratio: null };
  }

  const ratio = MIN_COMPRESSION_RATIO + Math.random() * (MAX_COMPRESSION_RATIO - MIN_COMPRESSION_RATIO);
  const outputTokens = Math.round(combinedTokens * ratio);
  return { needed: true, outputTokens, ratio };
}
