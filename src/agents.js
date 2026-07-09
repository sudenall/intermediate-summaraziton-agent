// Simulated sub-agents.
//
// Nothing here calls a real model. Each agent is a small local function that
// fabricates a plausible token count and latency, and occasionally "fails"
// according to a configurable failure rate so the resilience patterns have
// something real to react to. Failures are classified as TransientError
// (the common case: rate limits, timeouts, flaky upstreams) or FatalError
// (rare: malformed input, auth-style failures) using `fatalShare`.

import { TransientError, FatalError } from "./errors.js";

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Baseline behavior per agent role. `failureRate` and `fatalShare` are
// injected per run by the orchestrator so naive/resilient/comparison modes
// can dial failure conditions up or down without editing this table.
export const AGENT_PROFILES = {
  search: { minTokens: 2200, maxTokens: 4200, minLatency: 30, maxLatency: 120 },
  retrieval: { minTokens: 2800, maxTokens: 5200, minLatency: 40, maxLatency: 140 },
  summarization: { minTokens: 0, maxTokens: 0, minLatency: 50, maxLatency: 160 },
  synthesis: { minTokens: 400, maxTokens: 900, minLatency: 60, maxLatency: 180 },
};

/**
 * Simulate a single call to a sub-agent.
 *
 * @param {string} role - one of AGENT_PROFILES keys
 * @param {object} opts
 * @param {number} opts.failureRate - probability (0..1) the call fails
 * @param {number} opts.fatalShare - of the failures, probability (0..1) they are fatal rather than transient
 * @param {number} [opts.inputTokens] - for summarization/synthesis, tokens fed in
 * @returns {Promise<{agent: string, tokens: number, latencyMs: number}>}
 */
export async function callAgent(role, { failureRate, fatalShare, inputTokens } = {}) {
  const profile = AGENT_PROFILES[role];
  if (!profile) throw new FatalError(`Unknown agent role "${role}"`, { agent: role });

  const latencyMs = randomBetween(profile.minLatency, profile.maxLatency);
  await wait(latencyMs);

  if (Math.random() < failureRate) {
    const isFatal = Math.random() < fatalShare;
    if (isFatal) {
      throw new FatalError(`${role} agent rejected the request (malformed input / auth failure)`, { agent: role });
    }
    throw new TransientError(`${role} agent timed out / rate-limited`, { agent: role });
  }

  const tokens =
    role === "search" || role === "retrieval"
      ? randomBetween(profile.minTokens, profile.maxTokens)
      : role === "synthesis"
      ? randomBetween(profile.minTokens, profile.maxTokens)
      : 0; // summarization tokens are derived from compression, not this profile

  return { agent: role, tokens, latencyMs };
}
