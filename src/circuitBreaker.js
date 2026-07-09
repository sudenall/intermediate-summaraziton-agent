// Per-agent circuit breaker.
//
// Each simulated sub-agent gets its own breaker instance. After
// `failureThreshold` consecutive failures the circuit "opens" and further
// calls are short-circuited (rejected without even attempting the call) for
// `cooldownMs`. Once the cooldown elapses the breaker allows a single trial
// call through; success closes the circuit again, failure re-opens it
// immediately for another full cooldown.

export class CircuitBreaker {
  constructor({ agent, failureThreshold = 3, cooldownMs = 1500 }) {
    this.agent = agent;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.consecutiveFailures = 0;
    this.state = "healthy"; // "healthy" | "open"
    this.openedAt = null;
  }

  // Returns true if a call is currently allowed through the breaker.
  canCall() {
    if (this.state === "healthy") return true;

    const cooledDown = Date.now() - this.openedAt >= this.cooldownMs;
    if (cooledDown) {
      // Allow one trial call through without fully closing the circuit yet.
      // recordSuccess()/recordFailure() decide whether it stays healthy.
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.state = "healthy";
    this.openedAt = null;
  }

  recordFailure() {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  snapshot() {
    return {
      agent: this.agent,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}
