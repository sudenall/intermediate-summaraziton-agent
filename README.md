# Resilient Context Orchestrator

A small, self-contained simulator of a multi-agent pipeline that has to deal with
two problems every non-trivial agent system eventually runs into: **context that
grows faster than the downstream model's budget**, and **sub-agents that fail**.

Nothing in this repo calls a real language model. There are no API keys, no
network calls, and no third-party npm packages. Every "agent" is a local
function that fabricates a token count, a latency, and occasionally a failure,
so the orchestration logic around it has something realistic to react to. The
point of the project is the orchestration logic itself, not the text a model
would have generated.

## The pipeline

Four simulated roles, coordinated by a single orchestrator:

```
search        \
                >-- (compress if over budget) --> synthesis
retrieval     /
```

`search` and `retrieval` stand in for two independent upstream sources (e.g. a
web search and a document store). Their combined output can exceed what the
`synthesis` step can reasonably consume, so when it does, the orchestrator
routes it through a `summarization` step first.

The orchestrator is the only component that talks to the sub-agents directly
(hub-and-spoke). Sub-agents never call each other.

## The two paths

The demo runs the same simulated failure conditions through two code paths so
the effect of the resilience patterns is a measured difference, not a claim:

- **Naive** — calls each agent once, forwards whatever comes back regardless
  of size, and gives up the instant anything goes wrong.
- **Resilient** — applies context compression when the budget is exceeded,
  retries recoverable failures with backoff, and protects each agent behind
  its own circuit breaker.

### Context compression

`src/compression.js` holds a token budget constant
(`DEFAULT_CONTEXT_BUDGET_TOKENS`). Whenever `search` + `retrieval` output
exceeds it, the resilient path calls a simulated `summarization` agent that
reduces the combined token count by a randomized-but-realistic ratio before it
reaches `synthesis`. The naive path skips this step entirely and just
truncates at the budget, silently dropping whatever didn't fit.

### Typed errors

`src/errors.js` defines `TransientError` (rate limits, timeouts — retry makes
sense) and `FatalError` (malformed input, auth-style failures — retrying is
pointless). `src/orchestrator.js` treats them differently: transient failures
get retried locally with exponential backoff up to a configurable limit;
fatal failures are escalated straight to the orchestrator, which decides
whether the run can continue in a degraded form or has to fail outright. No
raw exception crosses from a sub-agent call into application code unhandled.

### Circuit breakers

`src/circuitBreaker.js` tracks consecutive failures per agent role. After a
configurable threshold, that agent's circuit opens and further calls are
skipped for a cooldown period instead of continuing to hit a dependency that's
already failing. Breaker state (`healthy` / `open`) is surfaced in the run log
and in the web demo.

## Running it

No install step — there are zero runtime dependencies.

```bash
# CLI: naive vs. resilient comparison, live log + summary table
node src/cli.js            # defaults to 12 runs per mode
node src/cli.js 25         # or pass a run count

# Web demo: live simulator with two run buttons and a streaming log
node web/serve.js          # serves on http://localhost:5173
```

The web demo needs to be served over HTTP (not opened as a `file://` path)
because it loads the simulation core as native ES modules.

It's also live on GitHub Pages — the root `index.html` just redirects into
`web/index.html`, which is the actual simulator, so the same static files
serve/dev'd locally work there unchanged.

The page has two buttons — "Run Naive (Anti-Pattern)" and "Run Resilient
(Recommended)" — each driving a batch of simulated tasks through
`src/orchestrator.js`'s `runNaive()` / `runResilient()` respectively. The log
panel streams the orchestrator's own log events as each task runs (task
markers, retries, compression, escalation, success/failure), and the metric
cards for that mode update after every task. "Reset" clears the log and both
card sets and creates fresh orchestrator instances (so circuit breaker state
doesn't carry over between sessions). Naive and resilient runs can be fired
independently and their log history stays interleaved (color-coded red vs.
green) so a viewer can compare both paths in the same panel.

## Layout

```
src/
  errors.js          TransientError / FatalError / CircuitOpenError
  circuitBreaker.js   per-agent breaker (healthy <-> open)
  agents.js           simulated search / retrieval / summarization / synthesis
  compression.js       token-budget check + simulated compression ratio
  orchestrator.js       coordinator: naive + resilient run methods
  compare.js            batch runner, aggregates naive vs resilient stats
  cli.js                terminal entry point
web/
  index.html, app.js, styles.css, serve.js   browser version of the same demo
```

## Why this is worth simulating

The interesting part of "resilient agent architecture" isn't the retry loop
itself, it's the *decision* about which failures deserve a retry, which
deserve an immediate stop, and how to keep a downstream step from choking on
upstream volume. Simulating the failure and token behavior instead of driving
it from a real model makes those decisions the entire visible surface of the
project, and makes the naive-vs-resilient comparison reproducible on demand
instead of depending on a model provider actually being flaky at the right
moment.
