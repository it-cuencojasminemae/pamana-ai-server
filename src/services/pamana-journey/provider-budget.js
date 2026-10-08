'use strict';

let active = 0;
const queue = [];
function drain() {
  while (active < 2 && queue.length) {
    const item = queue.shift();
    item.signal?.removeEventListener('abort', item.cancel);
    if (item.signal?.aborted) { item.reject(new Error('ROUTING_CANCELLED')); continue; }
    active++;
    item.resolve(() => { active--; drain(); });
  }
}
async function withProviderSlot(operation, signal) {
  if (signal?.aborted) throw new Error('ROUTING_CANCELLED');
  const release = await new Promise((resolve, reject) => {
    const item = { resolve, reject, signal };
    item.cancel = () => { const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1); reject(new Error('ROUTING_CANCELLED')); };
    signal?.addEventListener('abort', item.cancel, { once: true });
    queue.push(item); drain();
  });
  try { return await operation(); } finally { release(); }
}

function requestBudget(parentSignal, milliseconds) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parentSignal?.aborted) cancel();
  parentSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, milliseconds);
  return { signal: controller.signal, dispose() { clearTimeout(timer); parentSignal?.removeEventListener('abort', cancel); } };
}

module.exports = { withProviderSlot, requestBudget };
