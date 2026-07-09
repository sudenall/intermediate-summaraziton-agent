// Batch runner: executes the naive and resilient pipelines N times each
// under identical failure conditions and aggregates the results into a
// side-by-side comparison. This is the centerpiece of the demo -- it's the
// thing that makes "resilient patterns help" a measured claim instead of an
// assertion.

import { Orchestrator } from "./orchestrator.js";

function aggregate(mode, runs) {
  const successes = runs.filter((r) => r.success);
  const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  return {
    mode,
    totalRuns: runs.length,
    successCount: successes.length,
    successRate: runs.length ? successes.length / runs.length : 0,
    totalErrors: runs.reduce((sum, r) => sum + r.errors, 0),
    totalRetries: runs.reduce((sum, r) => sum + r.retries, 0),
    totalCircuitBlocks: runs.reduce((sum, r) => sum + (r.circuitBlocks || 0), 0),
    avgTokensAtSynthesis: Math.round(avg(successes.map((r) => r.tokensAtSynthesis))),
    avgCombinedTokens: Math.round(avg(runs.map((r) => r.combinedTokens))),
    compressionAppliedCount: runs.filter((r) => r.compressionApplied).length,
  };
}

/**
 * @param {object} opts
 * @param {number} opts.runs - number of iterations per mode
 * @param {object} [opts.orchestratorOptions] - shared config for both orchestrators
 * @param {(entry: object) => void} [opts.onLog] - streamed log callback
 * @returns {Promise<{naive: object, resilient: object}>}
 */
export async function runComparison({ runs = 12, orchestratorOptions = {}, onLog = () => {} } = {}) {
  const naiveOrchestrator = new Orchestrator({ ...orchestratorOptions, onLog });
  const resilientOrchestrator = new Orchestrator({ ...orchestratorOptions, onLog });

  const naiveRuns = [];
  for (let i = 0; i < runs; i++) {
    naiveRuns.push(await naiveOrchestrator.runNaive());
  }

  const resilientRuns = [];
  for (let i = 0; i < runs; i++) {
    resilientRuns.push(await resilientOrchestrator.runResilient());
  }

  return {
    naive: { ...aggregate("naive", naiveRuns), runs: naiveRuns },
    resilient: { ...aggregate("resilient", resilientRuns), runs: resilientRuns, circuitSnapshot: resilientOrchestrator.circuitSnapshot() },
  };
}
