// Wires the simulation core (src/orchestrator.js) to the page. This file
// only handles DOM rendering, batching, and pacing; every resilience
// mechanism it shows off -- compression, retries, escalation, circuit
// breakers -- runs inside the imported Orchestrator, not here.

import { Orchestrator } from "../src/orchestrator.js";

const consoleEl = document.getElementById("console");
const naiveBtn = document.getElementById("naiveBtn");
const resilientBtn = document.getElementById("resilientBtn");
const benchmarkBtn = document.getElementById("benchmarkBtn");
const resetBtn = document.getElementById("resetBtn");
const taskCountInput = document.getElementById("taskCountInput");
const failInput = document.getElementById("failInput");
const fatalInput = document.getElementById("fatalInput");

const PACE_MS = 220; // artificial gap between tasks so the log reads as a live process

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function appendLog(entry, mode, boundary = false) {
  const line = document.createElement("div");
  line.className = `line mode-${mode}${boundary ? " boundary" : ""}`;

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = new Date(entry.ts || Date.now()).toLocaleTimeString() + " ";

  const lvl = document.createElement("span");
  lvl.className = `lvl-${entry.level || "info"}`;
  lvl.textContent = (entry.level || "info").toUpperCase().padEnd(6, " ");

  const agent = document.createElement("span");
  agent.className = "agent";
  agent.textContent = entry.agent ? ` [${entry.agent}]` : "";

  const msg = document.createElement("span");
  msg.textContent = " " + entry.message;

  line.append(ts, lvl, agent, msg);
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function freshTotals() {
  return { tasks: 0, successes: 0, errors: 0, retries: 0, circuitBlocks: 0, escalations: 0, inputTokens: 0, synthesisTokens: 0, elapsedMs: 0 };
}

const state = {
  naiveOrchestrator: null,
  resilientOrchestrator: null,
  totals: { naive: freshTotals(), resilient: freshTotals() },
};

function makeOrchestrators() {
  const failureRate = Math.min(Math.max(Number(failInput.value) || 0.2, 0), 0.9);
  const fatalShare = Math.min(Math.max(Number(fatalInput.value) || 0.2, 0), 1);
  state.naiveOrchestrator = new Orchestrator({
    failureRate,
    fatalShare,
    onLog: (entry) => appendLog(entry, "naive"),
  });
  state.resilientOrchestrator = new Orchestrator({
    failureRate,
    fatalShare,
    onLog: (entry) => appendLog(entry, "resilient"),
  });
}

function renderCards(mode) {
  const t = state.totals[mode];
  const successRate = t.tasks ? Math.round((t.successes / t.tasks) * 100) : null;
  const interventions = t.retries + t.circuitBlocks + t.escalations;
  const avgElapsed = t.tasks ? Math.round(t.elapsedMs / t.tasks) : null;

  document.getElementById(`${mode}-successRate`).textContent = successRate === null ? "—" : `${successRate}%`;
  document.getElementById(`${mode}-errors`).textContent = t.tasks ? String(t.errors) : "—";
  document.getElementById(`${mode}-interventions`).textContent = t.tasks ? String(interventions) : "—";
  document.getElementById(`${mode}-interventionsDetail`).textContent = t.tasks
    ? `${t.retries} retries, ${t.escalations} escalations, ${t.circuitBlocks} circuit blocks`
    : "";
  document.getElementById(`${mode}-elapsed`).textContent = avgElapsed === null ? "—" : `${avgElapsed}ms`;
  document.getElementById(`${mode}-inputTokens`).textContent = t.tasks ? String(t.inputTokens) : "—";
  document.getElementById(`${mode}-synthesisTokens`).textContent = t.tasks ? String(t.synthesisTokens) : "—";
}

function setButtonsDisabled(disabled) {
  naiveBtn.disabled = disabled;
  resilientBtn.disabled = disabled;
  benchmarkBtn.disabled = disabled;
  resetBtn.disabled = disabled;
}

// Runs one mode's batch of tasks and streams progress. Does not touch
// button state, so naive and resilient batches can be driven concurrently
// (the side-by-side benchmark) without one finishing early re-enabling
// controls the other is still using.
async function runTasks(mode) {
  const orchestrator = mode === "naive" ? state.naiveOrchestrator : state.resilientOrchestrator;
  const taskCount = Math.min(Math.max(Number(taskCountInput.value) || 6, 3), 15);
  const label = mode === "naive" ? "NAIVE (anti-pattern)" : "RESILIENT (recommended)";

  appendLog({ level: "info", message: `=== ${label}: starting ${taskCount} tasks ===` }, mode, true);

  for (let i = 1; i <= taskCount; i++) {
    appendLog({ level: "info", message: `[Processing task-${i}]` }, mode);

    const result = mode === "naive" ? await orchestrator.runNaive() : await orchestrator.runResilient();

    const t = state.totals[mode];
    t.tasks += 1;
    if (result.success) t.successes += 1;
    t.errors += result.errors || 0;
    t.retries += result.retries || 0;
    t.circuitBlocks += result.circuitBlocks || 0;
    t.escalations += result.escalations || 0;
    t.inputTokens += result.combinedTokens || 0;
    t.synthesisTokens += result.tokensAtSynthesis || 0;
    t.elapsedMs += result.elapsedMs || 0;

    if (result.success) {
      appendLog({ level: "info", message: `SUCCESS: task-${i} completed (${result.combinedTokens} tok -> ${result.tokensAtSynthesis} tok at synthesis)` }, mode);
    } else {
      const reason = mode === "naive" ? "no recovery path available" : "coordinator exhausted recovery options";
      appendLog({ level: "error", message: `FAILED: task-${i} did not complete (${reason})` }, mode);
    }

    renderCards(mode);
    await wait(PACE_MS);
  }

  appendLog({ level: "info", message: "Workflow completed." }, mode, true);
}

async function runBatch(mode) {
  if (consoleEl.querySelector(".placeholder")) clearEl(consoleEl);
  setButtonsDisabled(true);
  await runTasks(mode);
  setButtonsDisabled(false);
}

async function runBenchmark() {
  if (consoleEl.querySelector(".placeholder")) clearEl(consoleEl);
  setButtonsDisabled(true);
  appendLog({ level: "info", message: "=== SIDE-BY-SIDE BENCHMARK: naive and resilient running concurrently ===" }, "neutral", true);
  await Promise.all([runTasks("naive"), runTasks("resilient")]);
  appendLog({ level: "info", message: "=== BENCHMARK COMPLETE ===" }, "neutral", true);
  setButtonsDisabled(false);
}

function resetAll() {
  clearEl(consoleEl);
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent = "Pick a path above to start the simulation.";
  consoleEl.appendChild(placeholder);

  state.totals = { naive: freshTotals(), resilient: freshTotals() };
  renderCards("naive");
  renderCards("resilient");
  makeOrchestrators();
  setButtonsDisabled(false);
}

naiveBtn.addEventListener("click", () => runBatch("naive"));
resilientBtn.addEventListener("click", () => runBatch("resilient"));
benchmarkBtn.addEventListener("click", runBenchmark);
resetBtn.addEventListener("click", resetAll);

resetAll();
