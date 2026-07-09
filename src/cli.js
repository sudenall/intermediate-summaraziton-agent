#!/usr/bin/env node
// CLI entry point: runs the naive-vs-resilient comparison and prints a
// live console-style log followed by a summary table. Everything below is
// simulation output -- no network calls, no API keys, no external packages.

import { runComparison } from "./compare.js";

const COLORS = {
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function printLog(entry) {
  const color = COLORS[entry.level] || "";
  const tag = entry.agent ? `[${entry.agent}]` : "";
  console.log(`${COLORS.dim}${new Date(entry.ts).toLocaleTimeString()}${COLORS.reset} ${color}${entry.level.toUpperCase().padEnd(5)}${COLORS.reset} ${tag} ${entry.message}`);
}

function printSummaryTable(comparison) {
  const { naive, resilient } = comparison;
  const rows = [
    ["Success rate", `${(naive.successRate * 100).toFixed(0)}%`, `${(resilient.successRate * 100).toFixed(0)}%`],
    ["Successful / total", `${naive.successCount}/${naive.totalRuns}`, `${resilient.successCount}/${resilient.totalRuns}`],
    ["Total errors", `${naive.totalErrors}`, `${resilient.totalErrors}`],
    ["Total retries", `${naive.totalRetries}`, `${resilient.totalRetries}`],
    ["Circuit blocks", `${naive.totalCircuitBlocks}`, `${resilient.totalCircuitBlocks}`],
    ["Avg combined tokens", `${naive.avgCombinedTokens}`, `${resilient.avgCombinedTokens}`],
    ["Avg tokens at synthesis", `${naive.avgTokensAtSynthesis}`, `${resilient.avgTokensAtSynthesis}`],
    ["Runs compressed", `-`, `${resilient.compressionAppliedCount}/${resilient.totalRuns}`],
  ];

  const col1 = Math.max(...rows.map((r) => r[0].length), "Metric".length) + 2;
  const col2 = Math.max(...rows.map((r) => r[1].length), "Naive".length) + 2;
  const col3 = Math.max(...rows.map((r) => r[2].length), "Resilient".length) + 2;

  const line = (a, b, c) => `${a.padEnd(col1)}${b.padEnd(col2)}${c.padEnd(col3)}`;

  console.log("\n" + COLORS.bold + line("Metric", "Naive", "Resilient") + COLORS.reset);
  console.log("-".repeat(col1 + col2 + col3));
  for (const [label, a, b] of rows) console.log(line(label, a, b));
  console.log();
}

async function main() {
  const runs = Number(process.argv[2]) || 12;
  console.log(`${COLORS.bold}Resilient Context Orchestrator - simulated comparison (${runs} runs per mode)${COLORS.reset}\n`);

  const comparison = await runComparison({ runs, onLog: printLog });

  printSummaryTable(comparison);
}

main();
