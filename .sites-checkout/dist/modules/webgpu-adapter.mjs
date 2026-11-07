// Use the same default adapter request as the readiness check, then try hints.
// An adapter can disappear between requests, so callers must still handle failure.
export async function requestCompatibleAdapter(gpu, preferred) {
  const choices = preferred ? [preferred, undefined, 'high-performance', 'low-power'] : [undefined, 'high-performance', 'low-power'];
  const tried = new Set();
  const outcomes = [];
  for (const choice of choices) {
    const key = choice || 'default';
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      const adapter = choice ? await gpu.requestAdapter({powerPreference: choice}) : await gpu.requestAdapter();
      if (adapter) return adapter;
      outcomes.push(`${key}: unavailable`);
    } catch (error) {
      outcomes.push(`${key}: ${error?.name || 'error'}`);
    }
  }
  const error = new Error(`no WebGPU adapter (${outcomes.join(', ')})`);
  error.name = 'GPUAdapterUnavailableError';
  throw error;
}
