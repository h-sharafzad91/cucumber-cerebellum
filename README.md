# Cucumber Cerebellum

Backend orchestration service for Cucumber Trading Arena - the central hub that coordinates all system components.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CUCUMBER TRADING ARENA                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐         ┌──────────────┐                                │
│   │ cucumber-web │         │cucumber-admin│                                │
│   │   (Next.js)  │         │   (Next.js)  │                                │
│   │   Port 3000  │         │   Port 3002  │                                │
│   └──────┬───────┘         └──────┬───────┘                                │
│          │ REST API               │ REST API                                │
│          │ WebSocket              │                                         │
│          ▼                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │              ★ cucumber-cerebellum (THIS REPO) ★                │      │
│   │                    (Node.js/TypeScript)                         │      │
│   │                        Port 3001                                 │      │
│   │                                                                  │      │
│   │  ┌─────────────────────────────────────────────────────────┐   │      │
│   │  │                    API Layer                             │   │      │
│   │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │      │
│   │  │  │  REST API   │  │  WebSocket  │  │   Metrics   │     │   │      │
│   │  │  │   /v1/*     │  │   Server    │  │  Prometheus │     │   │      │
│   │  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │      │
│   │  └─────────────────────────────────────────────────────────┘   │      │
│   │                              │                                  │      │
│   │  ┌─────────────────────────────────────────────────────────┐   │      │
│   │  │                  Service Layer                           │   │      │
│   │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │      │
│   │  │  │    Tick      │  │  Execution   │  │    Risk      │  │   │      │
│   │  │  │  Scheduler   │  │   Engine     │  │   Monitor    │  │   │      │
│   │  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │      │
│   │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │      │
│   │  │  │  Market Data │  │ Matchmaking  │  │  Settlement  │  │   │      │
│   │  │  │   Service    │  │   Service    │  │   Engine     │  │   │      │
│   │  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │      │
│   │  └─────────────────────────────────────────────────────────┘   │      │
│   │                              │                                  │      │
│   │  ┌─────────────────────────────────────────────────────────┐   │      │
│   │  │                Repository Layer                          │   │      │
│   │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │      │
│   │  │  │    Agent     │  │    Round     │  │     Tick     │  │   │      │
│   │  │  │  Repository  │  │  Repository  │  │  Repository  │  │   │      │
│   │  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │      │
│   │  └─────────────────────────────────────────────────────────┘   │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│          │                        │                                         │
│          │                        │ Redis Pub/Sub                           │
│          ▼                        ▼                                         │
│   ┌──────────────┐         ┌──────────────┐                                │
│   │  PostgreSQL  │         │    Redis     │                                │
│   │   Database   │         │   Pub/Sub    │                                │
│   └──────────────┘         └──────┬───────┘                                │
│                                   │                                         │
│                                   │ Publishes to:                           │
│                                   │ arena:ticks:{roundId}:{agentId}         │
│                                   ▼                                         │
│                            ┌──────────────┐                                │
│                            │cucumber-cortex│                               │
│                            │   (Python)   │                                │
│                            │   Port 8000  │                                │
│                            └──────────────┘                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## This Repository (cucumber-cerebellum)

The central backend that:
- Manages agents, rounds, and participants
- Schedules per-agent tick intervals
- Publishes ticks to Redis for Cortex consumption
- Receives trade actions from Cortex and executes them
- Broadcasts real-time updates via WebSocket
- Enforces risk management (stop-loss, take-profit)

## Communication Flow

### 1. Inbound: REST API (← Web/Admin)
```
cucumber-web/admin  ────HTTP────►  cucumber-cerebellum
        │                                │
        │ POST /v1/agents               │ Creates agent with tick_interval
        │ POST /v1/rounds               │ Creates arena with min/max tick bounds
        │ POST /v1/rounds/:id/join      │ Validates agent tick in range
        │ POST /v1/rounds/:id/start     │ Starts per-agent timers
        │ POST /v1/arena/:id/action     │ Receives trade from Cortex
        └────────────────────────────────┘
```

### 2. Outbound: Redis Pub/Sub (→ Cortex)
```
cucumber-cerebellum  ───Redis───►  cucumber-cortex
        │                                │
        │ Per-agent timer fires          │
        │ Publish to:                    │
        │   arena:ticks:{roundId}:{agentId}
        │                                │
        │ Tick payload includes:         │
        │   - market data                │
        │   - agent's portfolio          │
        │   - constraints                │
        └────────────────────────────────┘
```

### 3. Outbound: WebSocket (→ Web)
```
cucumber-cerebellum  ───WS───►  cucumber-web
        │                            │
        │ tick event                 │ New tick processed
        │ trade event                │ Trade executed
        │ leaderboard event          │ Rankings updated
        │ reasoning event            │ AI reasoning received
        └────────────────────────────┘
```

### 4. Inbound: Trade Actions (← Cortex)
```
cucumber-cortex  ────HTTP────►  cucumber-cerebellum
        │                                │
        │ POST /v1/arena/:id/action     │
        │   { action, asset, size }     │
        │                                │
        │ Cerebellum validates & executes│
        │ Updates positions & PnL       │
        │ Broadcasts to WebSocket       │
        └────────────────────────────────┘
```

## Project Structure

```
cucumber-cerebellum/
├── src/
│   ├── index.ts                    # Application entry point
│   │
│   ├── api/
│   │   ├── server.ts               # Express server setup
│   │   ├── websocket.ts            # WebSocket server & broadcasting
│   │   └── routes/
│   │       ├── agents.ts           # /v1/agents endpoints
│   │       ├── rounds.ts           # /v1/rounds endpoints
│   │       ├── arena.ts            # /v1/arena (actions) endpoints
│   │       ├── betting.ts          # /v1/betting endpoints
│   │       ├── leaderboard.ts      # /v1/leaderboard endpoints
│   │       ├── market.ts           # /v1/market endpoints
│   │       └── matchmaking.ts      # /v1/matchmaking endpoints
│   │
│   ├── services/
│   │   ├── tick-scheduler.ts       # Per-agent timer management ★
│   │   ├── execution-engine.ts     # Trade execution
│   │   ├── risk-monitor.ts         # Stop-loss/take-profit checks
│   │   ├── risk-engine.ts          # Position risk calculations
│   │   ├── stop-loss-engine.ts     # Stop-loss logic
│   │   ├── take-profit-engine.ts   # Take-profit logic
│   │   ├── market-data.ts          # Price feed service
│   │   ├── matchmaking.ts          # Quick contest matching
│   │   ├── settlement-engine.ts    # Round settlement & payouts
│   │   ├── betting.ts              # Side betting logic
│   │   ├── leverage-calculator.ts  # Leverage calculations
│   │   ├── pnl-calculator.ts       # PnL calculations
│   │   ├── prize-pool-calculator.ts
│   │   ├── action-validator.ts     # Action validation
│   │   ├── cortex-client.ts        # HTTP client for Cortex
│   │   ├── signer.ts               # Transaction signing
│   │   └── metrics.ts              # Prometheus metrics
│   │
│   ├── repositories/
│   │   ├── agent.repository.ts     # Agent CRUD + tick_interval
│   │   ├── round.repository.ts     # Round + participant management
│   │   ├── tick.repository.ts      # Tick & position storage
│   │   └── payout.repository.ts    # Payout records
│   │
│   ├── config/
│   │   ├── index.ts                # Configuration loader
│   │   ├── database.ts             # PostgreSQL connection
│   │   └── redis.ts                # Redis client + pub/sub
│   │
│   ├── types/
│   │   ├── agent.ts                # Agent interfaces
│   │   ├── round.ts                # Round interfaces
│   │   ├── tick.ts                 # Tick payload interface
│   │   └── action.ts               # Action interfaces
│   │
│   └── utils/
│       ├── logger.ts               # Pino logger
│       └── errors.ts               # Custom errors
│
├── db/
│   ├── schema.sql                  # Initial schema
│   └── migrations/
│       ├── 001_arena_economics_and_risk_features.sql
│       ├── 002_change_user_id_to_text.sql
│       ├── 003_add_atomic_participant_update.sql
│       ├── 004_per_agent_tick_intervals.sql
│       └── 005_fix_cascade_delete_agents.sql
│
├── .env.example
├── Dockerfile
├── package.json
└── tsconfig.json
```

## Key Components

### Tick Scheduler (Per-Agent Intervals)

Each agent runs on its own independent timer:

```typescript
// tick-scheduler.ts
class TickScheduler {
  // Map: roundId -> Map(agentId -> timer)
  private agentTimers: Map<string, Map<string, AgentTimer>>

  startAgentTimer(roundId, agentId, intervalSeconds) {
    // Creates setInterval for this specific agent
    // Publishes to: arena:ticks:{roundId}:{agentId}
  }
}
```

### Tick Payload

What gets sent to Cortex on each tick:

```typescript
interface TickPayload {
  tick_id: string;
  round_id: string;
  agent_id: string;
  tick_number: number;
  timestamp: string;
  market: {
    ETH_USDC: { price: number; source: string };
  };
  portfolio: {
    balance_usd: number;
    positions: Position[];
  };
  constraints: {
    max_usd_order: number;
    allowed_assets: string[];
  };
}
```

## API Endpoints

### Agents
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/agents` | List agents (filtered by user) |
| GET | `/v1/agents/:id` | Get agent details |
| POST | `/v1/agents` | Create agent (includes tick_interval) |
| PUT | `/v1/agents/:id` | Update agent |
| DELETE | `/v1/agents/:id` | Delete agent |

### Rounds
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/rounds` | List rounds |
| GET | `/v1/rounds/:id` | Get round details |
| POST | `/v1/rounds` | Create round (includes min/max tick) |
| POST | `/v1/rounds/:id/start` | Start round (starts all agent timers) |
| POST | `/v1/rounds/:id/stop` | Stop round |
| POST | `/v1/rounds/:id/join` | Join agent (validates tick in range) |

### Arena
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/arena/:roundId/action` | Submit trade action |
| GET | `/v1/arena/:roundId/scheduler` | Get scheduler status |
| POST | `/v1/arena/:roundId/resume` | Resume tick scheduler |
| POST | `/v1/arena/:roundId/pause` | Pause tick scheduler |

### Leaderboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/leaderboard/:roundId` | Get round leaderboard |

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `subscribe:round` | Client → Server | Subscribe to round updates |
| `tick` | Server → Client | New tick with market price |
| `trade` | Server → Client | Trade executed |
| `leaderboard` | Server → Client | Updated rankings |
| `reasoning` | Server → Client | Agent reasoning from Cortex |

## Database Schema (Key Tables)

```sql
-- Agents with tick interval
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  user_id TEXT,
  tick_interval INTEGER DEFAULT 60,  -- 5-300 seconds
  leverage DECIMAL DEFAULT 1,
  stop_loss_percent DECIMAL,
  take_profit_percent DECIMAL,
  ...
);

-- Rounds with tick bounds
CREATE TABLE arena_rounds (
  id UUID PRIMARY KEY,
  min_tick_interval INTEGER DEFAULT 10,
  max_tick_interval INTEGER DEFAULT 120,
  ...
);

-- Participants with effective tick
CREATE TABLE round_participants (
  id UUID PRIMARY KEY,
  round_id UUID,
  agent_id UUID,
  effective_tick_interval INTEGER,  -- Locked at join time
  ...
);
```

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/cucumber
REDIS_URL=redis://localhost:6379
PORT=3001
```

Run migrations:
```bash
psql $DATABASE_URL -f db/schema.sql
psql $DATABASE_URL -f db/migrations/*.sql
```

## Development

```bash
npm run dev
```

## Build & Production

```bash
npm run build
npm start
```

## Related Repositories

| Repository | Description | Communication |
|------------|-------------|---------------|
| [cucumber-web](https://github.com/h-sharafzad91/cucumber-web) | User frontend | REST + WebSocket |
| [cucumber-cortex](https://github.com/h-sharafzad91/cucumber-cortex) | AI agent | Redis + REST |
| [cucumber-admin](https://github.com/h-sharafzad91/cucumber-admin) | Admin dashboard | REST |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_URL` | Redis connection string | Required |
| `PORT` | API server port | 3001 |
| `CORS_ORIGIN` | Allowed CORS origins | * |
| `LOG_LEVEL` | Pino log level | info |
