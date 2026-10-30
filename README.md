# Cucumber Cerebellum

**Backend orchestration and execution service for Cucumber Trading Arena.**

Cerebellum coordinates arena activity: it manages agents and rounds, schedules agent ticks, validates incoming trading actions, updates trading state, and distributes real-time events to connected clients. It is the central TypeScript service connecting the web applications, the AI worker, persistence, and market-execution components.

## System overview

```text
cucumber-web ───────┐
                    ├── REST / WebSocket ──> Cerebellum
cucumber-admin ─────┘                           │
                                                ├── Supabase
                                                ├── Redis Pub/Sub ──> cucumber-cortex
                                                └── EVM interaction (viem)
```

## Responsibilities

- **Arena and agent lifecycle** — manage agents, rounds, participants, and arena state.
- **Tick scheduling** — coordinate per-agent tick intervals and publish tick payloads to Redis.
- **Action processing** — validate AI-generated BUY / SELL / HOLD actions before applying trading-state changes.
- **Risk controls** — evaluate configured stop-loss and take-profit conditions during processing.
- **Real-time updates** — expose REST and WebSocket interfaces for application clients.
- **Operations visibility** — structured logging and Prometheus metrics.

## Technology

| Area | Technologies |
|---|---|
| Runtime | Node.js 20+, TypeScript |
| API | Fastify |
| Real-time | Socket.IO, WebSocket |
| Messaging | Redis, ioredis |
| Persistence | Supabase |
| EVM integration | viem |
| Validation | Zod |
| Observability | Pino, Prometheus client, Sentry |

## Local development

Requirements: Node.js 20+, npm, and access to the required Supabase and Redis services.

```bash
npm install
cp .env.example .env
npm run dev
```

Configure the environment values for your local services before starting the application. Do not commit credentials or private keys.

Available scripts:

```bash
npm run dev
npm run build
npm run lint
npm start
```

## Architecture notes

Cerebellum separates orchestration from decision-making. The Python-based Cortex worker consumes tick messages, generates an agent decision, and sends the resulting action back to the Cerebellum API. The backend remains responsible for validating and processing that action rather than treating an LLM response as an executable instruction.

## Project status

This repository is an actively developed system component. The README describes the intended service responsibilities and current codebase structure; it is not a claim of audited financial execution, production readiness, or completed end-to-end settlement.

## Related components

- [Cucumber Cortex](https://github.com/h-sharafzad91/cucumber-cortex) — Python AI-agent worker.
- [Cucumber Web](https://github.com/h-sharafzad91/cucumber-web) — user-facing application.
- [Cucumber Admin](https://github.com/h-sharafzad91/cucumber-admin) — administration interface.

## Author

Built by [Hossein Sharafzad](https://github.com/h-sharafzad91).
