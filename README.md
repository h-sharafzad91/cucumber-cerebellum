# Cucumber Cerebellum

**Cucumber Cerebellum** is the orchestration backend for Cucumber Trading Arena. It coordinates agent ticks, market-data delivery, trade-action processing, risk checks, persistence, settlement workflows, and real-time updates.

This repository is the TypeScript backend component in a multi-service system.

## System context

| Component | Responsibility |
|---|---|
| cucumber-web | User-facing web application |
| cucumber-admin | Administrative interface |
| cucumber-cerebellum | API, orchestration, scheduling, execution, risk and settlement |
| cucumber-cortex | Python service for agent reasoning |
| PostgreSQL | Persistent application data |
| Redis | Tick and service messaging |

Cerebellum communicates with the Cortex service through Redis and HTTP workflows and provides real-time updates to connected clients.

## Main responsibilities

- Manage agents, rounds, and arena participants.
- Schedule per-agent tick intervals.
- Publish tick payloads to Redis for Cortex processing.
- Validate and process agent trade actions.
- Coordinate execution and position updates.
- Apply risk-management rules such as stop-loss and take-profit checks.
- Broadcast tick, trade, leaderboard, and reasoning events through WebSocket/Socket.IO.
- Coordinate round settlement and payout accounting.

## Technology

- Node.js and TypeScript
- Fastify-based HTTP API
- PostgreSQL
- Redis Pub/Sub
- WebSocket / Socket.IO
- EVM transaction integration through viem

## Source layout

```text
src/
├── api/            HTTP routes and WebSocket server
├── config/         Environment-backed configuration
├── repositories/   Persistence and data access
├── services/       Scheduling, execution, risk, market data and settlement
└── index.ts        Application entry point
```

Exact modules may evolve; inspect the current source tree for the latest structure.

## Local development

Install dependencies:

```bash
npm install
```

Configure the environment using the variables and examples documented in the repository. The service requires the appropriate PostgreSQL and Redis connectivity; blockchain execution also requires carefully scoped network and signer configuration.

Use the scripts defined in `package.json` to run the service, type checks, and tests.

## Trading and signer safety

The repository includes both simulated/paper-trading and blockchain execution paths. Verify the effective environment configuration before running any execution workflow. In particular:

- Explicitly configure paper-trading mode rather than relying on defaults.
- Keep signer private keys outside source control and use isolated test wallets for development.
- Restrict transaction destinations, contract methods, value, and network as part of the execution policy.
- Treat internal settlement/accounting records separately from confirmed external payments.
- Protect scheduler and administrative endpoints with authentication and authorization.

## Project status and limitations

Cucumber is an evolving engineering project. The presence of execution, signer, or settlement modules does not imply that the system is audited, production-ready, or safe for real funds. Security review, route-level authorization, transaction-policy enforcement, idempotent settlement, and automated tests are important prerequisites before any real-value use.

## Maintainer

**Hossein Sharafzad**