import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const ticksProcessed = new Counter({
  name: 'cucumber_ticks_processed_total',
  help: 'Total number of ticks processed',
  labelNames: ['round_id'],
  registers: [registry],
});

export const tickLatency = new Histogram({
  name: 'cucumber_tick_latency_seconds',
  help: 'Tick processing latency in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const llmLatency = new Histogram({
  name: 'cucumber_llm_latency_seconds',
  help: 'LLM API response latency',
  labelNames: ['provider', 'model'],
  buckets: [0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const activeParticipants = new Gauge({
  name: 'cucumber_active_participants',
  help: 'Number of active participants in current round',
  registers: [registry],
});

export const tradesExecuted = new Counter({
  name: 'cucumber_trades_executed_total',
  help: 'Total trades executed',
  labelNames: ['action', 'status'],
  registers: [registry],
});

export const activeRounds = new Gauge({
  name: 'cucumber_active_rounds',
  help: 'Number of active arena rounds',
  registers: [registry],
});
