// Orchestrator: the single coordinator that talks to every sub-agent.
//
// This is a hub-and-spoke coordinator, not a mesh: search, retrieval,
// summarization and synthesis never call each other, they only ever get
// called by (and report back to) this orchestrator. It owns task state for
// a run, owns the circuit breakers, and is the "coordinator/handler layer"
// that error handling escalates to -- a FatalError from a sub-agent never
// propagates past this file uncaught.

import { CircuitBreaker } from "./circuitBreaker.js";
import { callAgent } from "./agents.js";
import { planCompression, DEFAULT_CONTEXT_BUDGET_TOKENS } from "./compression.js";
import { TransientError, FatalError, CircuitOpenError } from "./errors.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ROLES = ["search", "retrieval", "summarization", "synthesis"];

export class Orchestrator {
  constructor({
    contextBudgetTokens = DEFAULT_CONTEXT_BUDGET_TOKENS,
    failureRate = 0.18,
    fatalShare = 0.2,
    maxRetries = 2,
    baseBackoffMs = 120,
    circuitFailureThreshold = 3,
    circuitCooldownMs = 900,
    onLog = () => {},
  } = {}) {
    this.contextBudgetTokens = contextBudgetTokens;
    this.failureRate = failureRate;
    this.fatalShare = fatalShare;
    this.maxRetries = maxRetries;
    this.baseBackoffMs = baseBackoffMs;
    this.onLog = onLog;

    this.breakers = Object.fromEntries(
      ROLES.map((role) => [role, new CircuitBreaker({ agent: role, failureThreshold: circuitFailureThreshold, cooldownMs: circuitCooldownMs })])
    );
  }

  log(level, message, extra = {}) {
    this.onLog({ ts: Date.now(), level, message, ...extra });
  }

  circuitSnapshot() {
    return Object.fromEntries(Object.entries(this.breakers).map(([role, b]) => [role, b.snapshot()]));
  }

  // Retry/backoff + circuit-breaker wrapper shared by the resilient path.
  // TransientError -> retried with exponential backoff up to maxRetries.
  // FatalError -> escalated immediately to the caller, never retried.
  // Open circuit -> call is skipped entirely (no dependency-hammering).
  async callResilient(role, callArgs, metrics) {
    const breaker = this.breakers[role];
    let attempt = 0;

    while (true) {
      if (!breaker.canCall()) {
        this.log("warn", `circuit OPEN for ${role}, skipping call`, { agent: role });
        metrics.circuitBlocks += 1;
        throw new CircuitOpenError(`circuit open for ${role}`, { agent: role });
      }

      try {
        const result = await callAgent(role, { ...callArgs, failureRate: this.failureRate, fatalShare: this.fatalShare });
        breaker.recordSuccess();
        if (attempt > 0) this.log("info", `${role} succeeded after ${attempt} retr${attempt === 1 ? "y" : "ies"}`, { agent: role });
        else this.log("info", `${role} ok (${result.tokens || 0} tok, ${result.latencyMs}ms)`, { agent: role });
        return result;
      } catch (err) {
        breaker.recordFailure();
        metrics.errors += 1;

        if (err instanceof FatalError) {
          this.log("error", `${role} FATAL: ${err.message} -> escalating to coordinator, no retry`, { agent: role });
          throw err;
        }

        // TransientError: retry locally with exponential backoff.
        attempt += 1;
        if (attempt > this.maxRetries) {
          this.log("error", `${role} exhausted ${this.maxRetries} retries: ${err.message}`, { agent: role });
          throw err;
        }
        const delay = this.baseBackoffMs * 2 ** (attempt - 1) + Math.random() * this.baseBackoffMs * 0.3;
        metrics.retries += 1;
        this.log("warn", `${role} transient failure, retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms`, { agent: role });
        await wait(delay);
      }
    }
  }

  // Naive call: no retries, no circuit breaker, no compression. Any error
  // (transient or fatal) immediately fails the whole run.
  async callNaive(role, callArgs, metrics) {
    try {
      const result = await callAgent(role, { ...callArgs, failureRate: this.failureRate, fatalShare: this.fatalShare });
      this.log("info", `${role} ok (${result.tokens || 0} tok, ${result.latencyMs}ms)`, { agent: role });
      return result;
    } catch (err) {
      metrics.errors += 1;
      this.log("error", `${role} failed, no recovery path: ${err.message}`, { agent: role });
      throw err;
    }
  }

  async runNaive() {
    const metrics = { errors: 0, retries: 0, circuitBlocks: 0 };
    this.log("info", "=== naive run start ===");
    try {
      const [search, retrieval] = await Promise.all([
        this.callNaive("search", {}, metrics),
        this.callNaive("retrieval", {}, metrics),
      ]);

      const combinedTokens = search.tokens + retrieval.tokens;
      const overBudget = combinedTokens > this.contextBudgetTokens;
      // Naive path has no compression step: it forwards whatever it has and
      // silently truncates at the budget, losing context instead of
      // condensing it.
      const tokensAtSynthesis = overBudget ? this.contextBudgetTokens : combinedTokens;
      if (overBudget) {
        this.log("warn", `context overflow: ${combinedTokens} tok > budget ${this.contextBudgetTokens}, truncating (no compression)`);
      }

      await this.callNaive("synthesis", {}, metrics);

      this.log("info", "=== naive run: SUCCESS ===");
      return {
        mode: "naive",
        success: true,
        combinedTokens,
        tokensAtSynthesis,
        contextTruncated: overBudget,
        compressionApplied: false,
        ...metrics,
      };
    } catch (err) {
      this.log("error", `=== naive run: FAILED (${err.name}: ${err.message}) ===`);
      return {
        mode: "naive",
        success: false,
        combinedTokens: 0,
        tokensAtSynthesis: 0,
        contextTruncated: false,
        compressionApplied: false,
        ...metrics,
      };
    }
  }

  async runResilient() {
    const metrics = { errors: 0, retries: 0, circuitBlocks: 0 };
    this.log("info", "=== resilient run start ===");

    // search and retrieval are independent sources; losing one degrades
    // the run instead of failing it outright, as long as at least one
    // source comes back.
    const sources = await Promise.all(
      ["search", "retrieval"].map(async (role) => {
        try {
          const result = await this.callResilient(role, {}, metrics);
          return { role, ok: true, tokens: result.tokens };
        } catch (err) {
          this.log("warn", `${role} unavailable this run, coordinator continuing with partial context`, { agent: role });
          return { role, ok: false, tokens: 0 };
        }
      })
    );

    const available = sources.filter((s) => s.ok);
    if (available.length === 0) {
      this.log("error", "=== resilient run: FAILED (no sources available) ===");
      return { mode: "resilient", success: false, combinedTokens: 0, tokensAtSynthesis: 0, compressionApplied: false, degradedSources: 2, ...metrics };
    }

    const combinedTokens = available.reduce((sum, s) => sum + s.tokens, 0);
    const plan = planCompression(combinedTokens, this.contextBudgetTokens);

    let tokensAtSynthesis = plan.outputTokens;
    let compressionApplied = false;

    if (plan.needed) {
      this.log("info", `combined ${combinedTokens} tok exceeds budget ${this.contextBudgetTokens}, compressing`);
      try {
        // The summarizer call itself is resilient (retries/circuit) too;
        // its simulated token output is the compression plan's estimate.
        await this.callResilient("summarization", {}, metrics);
        compressionApplied = true;
        this.log("info", `compression done: ${combinedTokens} -> ${tokensAtSynthesis} tok (ratio ${plan.ratio.toFixed(2)})`);
      } catch (err) {
        // Summarizer unavailable: fall back to a truncated context rather
        // than failing the whole run, mirroring the naive path's degraded
        // behavior but only as a last resort.
        tokensAtSynthesis = this.contextBudgetTokens;
        this.log("warn", `summarization unavailable, falling back to truncated context (${tokensAtSynthesis} tok)`);
      }
    }

    try {
      await this.callResilient("synthesis", {}, metrics);
      this.log("info", "=== resilient run: SUCCESS ===");
      return {
        mode: "resilient",
        success: true,
        combinedTokens,
        tokensAtSynthesis,
        compressionApplied,
        degradedSources: 2 - available.length,
        ...metrics,
      };
    } catch (err) {
      this.log("error", `=== resilient run: FAILED (synthesis: ${err.name}) ===`);
      return {
        mode: "resilient",
        success: false,
        combinedTokens,
        tokensAtSynthesis,
        compressionApplied,
        degradedSources: 2 - available.length,
        ...metrics,
      };
    }
  }
}
