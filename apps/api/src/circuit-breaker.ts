type CircuitState = { failures: number; openedAt?: number };
const circuits = new Map<string, CircuitState>();

export async function resilientFetch(key: string, input: string | URL | Request, init?: RequestInit) {
  const threshold = Math.max(2, Number(process.env.CIRCUIT_BREAKER_FAILURES || 5));
  const resetMs = Math.max(5_000, Number(process.env.CIRCUIT_BREAKER_RESET_MS || 60_000));
  const state = circuits.get(key) ?? { failures: 0 };
  if (state.openedAt && Date.now() - state.openedAt < resetMs) {
    throw new Error(`${key.toUpperCase()}_CIRCUIT_OPEN: provedor temporariamente isolado apos falhas consecutivas`);
  }
  if (state.openedAt) circuits.set(key, { failures: 0 });
  try {
    const response = await fetch(input, init);
    if (response.status === 429 || response.status >= 500) {
      const failures = (circuits.get(key)?.failures ?? state.failures) + 1;
      circuits.set(key, { failures, ...(failures >= threshold ? { openedAt: Date.now() } : {}) });
    } else circuits.delete(key);
    return response;
  } catch (error) {
    const failures = (circuits.get(key)?.failures ?? state.failures) + 1;
    circuits.set(key, { failures, ...(failures >= threshold ? { openedAt: Date.now() } : {}) });
    throw error;
  }
}

export function circuitStatus() {
  return [...circuits.entries()].map(([provider, state]) => ({ provider, failures: state.failures, open: Boolean(state.openedAt), openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null }));
}

export function resetCircuit(provider?: string) { if (provider) circuits.delete(provider); else circuits.clear(); }
