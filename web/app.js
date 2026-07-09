// Wires the simulation core (src/) to the page. This file only handles DOM
// rendering and streaming; all agent/orchestrator/compression logic lives in
// ../src and is exactly what the CLI (src/cli.js) also runs.

import { runComparison } from "../src/compare.js";

const consoleEl = document.getElementById("console");
const resultsEl = document.getElementById("results");
const runBtn = document.getElementById("runBtn");
const runsInput = document.getElementById("runsInput");
const failInput = document.getElementById("failInput");

function appendLog(entry) {
  const line = document.createElement("div");
  line.className = "line";

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = new Date(entry.ts).toLocaleTimeString() + " ";

  const lvl = document.createElement("span");
  lvl.className = `lvl-${entry.level}`;
  lvl.textContent = entry.level.toUpperCase().padEnd(6, " ");

  const agent = document.createElement("span");
  agent.className = "agent";
  agent.textContent = entry.agent ? ` [${entry.agent}]` : "";

  const msg = document.createElement("span");
  msg.textContent = " " + entry.message;

  line.append(ts, lvl, agent, msg);
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function barRow(container, label, naiveVal, resilientVal, max, formatFn) {
  const block = document.createElement("div");
  block.className = "metric-block";

  const heading = document.createElement("div");
  heading.className = "metric-label";
  heading.textContent = label;
  block.appendChild(heading);

  for (const [name, cls, val] of [["Naive", "naive", naiveVal], ["Resilient", "resilient", resilientVal]]) {
    const row = document.createElement("div");
    row.className = "bar-row";

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = name;

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = `bar-fill ${cls}`;
    const pct = max > 0 ? Math.max((val / max) * 100, val > 0 ? 2 : 0) : 0;
    fill.style.width = pct + "%";
    track.appendChild(fill);

    const valueEl = document.createElement("div");
    valueEl.className = "value";
    valueEl.textContent = formatFn(val);

    row.append(nameEl, track, valueEl);
    block.appendChild(row);
  }

  container.appendChild(block);
}

function renderResults(comparison) {
  const { naive, resilient } = comparison;
  clearEl(resultsEl);

  barRow(resultsEl, "Success rate", naive.successRate * 100, resilient.successRate * 100, 100, (v) => v.toFixed(0) + "%");
  barRow(
    resultsEl,
    "Avg tokens delivered to synthesis",
    naive.avgTokensAtSynthesis,
    resilient.avgTokensAtSynthesis,
    Math.max(naive.avgTokensAtSynthesis, resilient.avgTokensAtSynthesis, 1),
    (v) => String(Math.round(v))
  );
  barRow(
    resultsEl,
    "Total errors encountered",
    naive.totalErrors,
    resilient.totalErrors,
    Math.max(naive.totalErrors, resilient.totalErrors, 1),
    (v) => String(v)
  );
  barRow(
    resultsEl,
    "Recovery actions (retries + circuit blocks)",
    0,
    resilient.totalRetries + resilient.totalCircuitBlocks,
    Math.max(resilient.totalRetries + resilient.totalCircuitBlocks, 1),
    (v) => String(v)
  );

  const table = document.createElement("table");
  table.className = "summary";
  const rows = [
    ["Runs", naive.totalRuns, resilient.totalRuns],
    ["Successful runs", naive.successCount, resilient.successCount],
    ["Avg combined tokens (pre-compression)", naive.avgCombinedTokens, resilient.avgCombinedTokens],
    ["Runs compressed", "-", `${resilient.compressionAppliedCount}/${resilient.totalRuns}`],
  ];
  table.innerHTML =
    "<thead><tr><th>Metric</th><th>Naive</th><th>Resilient</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const [label, a, b] of rows) {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = label;
    const tdA = document.createElement("td");
    tdA.className = "num";
    tdA.textContent = String(a);
    const tdB = document.createElement("td");
    tdB.className = "num";
    tdB.textContent = String(b);
    tr.append(tdLabel, tdA, tdB);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  resultsEl.appendChild(table);

  if (resilient.circuitSnapshot) {
    const heading = document.createElement("div");
    heading.className = "metric-label";
    heading.style.marginTop = "16px";
    heading.textContent = "Circuit breaker state (resilient run, end of batch)";
    resultsEl.appendChild(heading);

    const chips = document.createElement("div");
    chips.className = "chips";
    for (const snap of Object.values(resilient.circuitSnapshot)) {
      const chip = document.createElement("span");
      const healthy = snap.state === "healthy";
      chip.className = `chip ${healthy ? "good" : "critical"}`;
      const dot = document.createElement("span");
      dot.className = "dot";
      chip.appendChild(dot);
      const label = document.createElement("span");
      label.textContent = `${snap.agent}: ${healthy ? "healthy" : "open"}`;
      chip.appendChild(label);
      chips.appendChild(chip);
    }
    resultsEl.appendChild(chips);
  }
}

async function run() {
  runBtn.disabled = true;
  clearEl(consoleEl);
  clearEl(resultsEl);
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent = "Running...";
  resultsEl.appendChild(placeholder);

  const runs = Math.min(Math.max(Number(runsInput.value) || 12, 3), 40);
  const failureRate = Math.min(Math.max(Number(failInput.value) || 0.18, 0), 0.9);

  try {
    const comparison = await runComparison({
      runs,
      orchestratorOptions: { failureRate },
      onLog: appendLog,
    });
    renderResults(comparison);
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", run);
