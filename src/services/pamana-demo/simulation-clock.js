'use strict';

function elapsedSimulationSeconds({ now = new Date(), startedAt = now, explicitElapsedSeconds } = {}) {
  if (explicitElapsedSeconds !== undefined) {
    const explicit = Number(explicitElapsedSeconds);
    if (!Number.isFinite(explicit) || explicit < 0) throw new Error('INVALID_SIMULATION_TIME');
    return explicit;
  }
  const current = new Date(now).getTime();
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(current) || !Number.isFinite(start)) throw new Error('INVALID_SIMULATION_CLOCK');
  return Math.max(0, (current - start) / 1000);
}

module.exports = { elapsedSimulationSeconds };
