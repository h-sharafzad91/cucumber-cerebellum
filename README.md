# Cucumber Cerebellum

Backend orchestration service for Cucumber Trading Arena - the central hub that coordinates all system components. Named after the brain's cerebellum which coordinates movement and timing, this service coordinates the timing of trades and the flow of data between all components.

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
- **Manages agents, rounds, and participants**: CRUD operations for all entities, stores configurations in PostgreSQL
- **Schedules per-agent tick intervals**: Each agent has its own timer (e.g., Agent A ticks every 30s, Agent B every 60s). Uses Node.js `setInterval` per agent, not a global tick
- **Publishes ticks to Redis for Cortex consumption**: When an agent's timer fires, publishes a message to `arena:ticks:{roundId}:{agentId}` containing market data and the agent's portfolio
- **Receives trade actions from Cortex and executes them**: Cortex sends POST `/v1/arena/:id/action` with BUY/SELL/HOLD. Cerebellum validates the action, calculates slippage, updates positions and balances
- **Broadcasts real-time updates via WebSocket**: Uses Socket.IO to push tick, trade, leaderboard, and reasoning events to connected frontends
- **Enforces risk management (stop-loss, take-profit)**: Before each tick, checks if any positions should be auto-closed based on agent's risk settings

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
│   │   ├── market-data.ts          # Multi-pair price feed (Pyth + Binance)
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
│   │   ├── tick.repository.ts      # Tick storage + performance history
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

The tick scheduler is the heart of the system. Unlike traditional systems that tick all agents at once, Cucumber uses **per-agent timers**:

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

**Why per-agent timers?**
- Agents can have different trading frequencies (fast traders vs patient traders)
- Prevents all agents from trading at the exact same moment (more realistic)
- Allows arena operators to set min/max bounds (e.g., 10s-120s) for fairness
- Agent's tick_interval is locked when joining (stored as `effective_tick_interval`)

**Flow when an agent's timer fires:**
1. Tick Scheduler creates a unique `tick_id`
2. Fetches current market prices from `market-data.ts`
3. Fetches agent's current portfolio (balance + positions) from database
4. Runs risk checks: if stop-loss or take-profit triggered, auto-closes position
5. Builds `TickPayload` with all data the AI needs
6. Publishes to Redis channel `arena:ticks:{roundId}:{agentId}`
7. Broadcasts tick event to WebSocket clients
8. Updates leaderboard and broadcasts

### Tick Payload

What gets sent to Cortex on each tick:

```typescript
interface TickPayload {
  tick_id: string;          // Unique ID for this tick (used to prevent duplicate actions)
  round_id: string;         // Which arena/round this is for
  agent_id: string;         // Which agent should process this
  tick_number: number;      // Sequential tick count for this agent in this round
  timestamp: string;        // ISO timestamp of when tick was generated
  market: {
    ETH_USDC: { price: number; source: string };  // Current market price
  };
  portfolio: {
    balance_usd: number;    // Agent's available cash
    positions: Position[];  // Agent's open positions (long/short)
  };
  constraints: {
    max_usd_order: number;  // Maximum order size allowed
    allowed_assets: string[]; // Which assets can be traded
  };
}
```

### Trade Execution Flow

When Cortex sends a trade action back:

1. **Validation** (`action-validator.ts`):
   - Check tick_id matches (prevent replays)
   - Check agent is still in round
   - Check action is valid (BUY_MARKET, SELL_MARKET, HOLD)
   - Check order size within constraints

2. **Leverage Calculation** (`leverage-calculator.ts`):
   - If agent has 2x leverage and orders $100, effective position is $200
   - Checks if agent has sufficient margin

3. **Execution** (`execution-engine.ts`):
   - Calculates slippage based on order size
   - Updates agent's position in database
   - Deducts/adds to balance

4. **PnL Update** (`pnl-calculator.ts`):
   - Calculates realized PnL (if closing position)
   - Calculates unrealized PnL (mark-to-market)
   - Updates `round_participants` table

5. **Broadcast**:
   - Sends trade event via WebSocket
   - Sends reasoning event (AI's explanation)
   - Updates and broadcasts leaderboard

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
| GET | `/v1/arena/:roundId/performance/:agentId` | Get agent tick-by-tick P&L history |

### Leaderboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/leaderboard/:roundId` | Get round leaderboard |

### Performance History

The performance endpoint returns tick-by-tick P&L data for charting:

```typescript
interface PerformanceDataPoint {
  tick_number: number;
  timestamp: string;
  realized_pnl: number;      // Cumulative realized P&L
  pnl_impact: number;        // P&L change from this tick
  balance: number;           // Current cash balance
  portfolio_value: number;   // Total portfolio value
  action: string;            // BUY_MARKET, SELL_MARKET, or HOLD
  asset?: string;            // Traded asset (if any)
  size_usd?: number;         // Trade size (if any)
}
```

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

## Railway Deployment

Cerebellum is the central service - deploy this FIRST, then the others.

### 1. Create Railway Project
1. Go to [Railway](https://railway.app) and create a new project
2. This project will contain all Cucumber services

### 2. Add PostgreSQL Database
1. Click "New" → "Database" → "PostgreSQL"
2. Railway creates a managed PostgreSQL instance
3. Copy the `DATABASE_URL` from the Variables tab

### 3. Add Redis
1. Click "New" → "Database" → "Redis"
2. Railway creates a managed Redis instance
3. Copy the `REDIS_URL` from the Variables tab

### 4. Deploy Cerebellum Service
1. Click "New" → "GitHub Repo"
2. Connect `h-sharafzad91/cucumber-cerebellum`

### 5. Configure Environment Variables
In the Cerebellum service, add these variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference to PostgreSQL plugin |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | Reference to Redis plugin |
| `PORT` | `3001` | API port (Railway provides $PORT automatically) |
| `CORS_ORIGIN` | `https://cucumber-web-production.up.railway.app,https://cucumber-admin-production.up.railway.app` | Allowed origins |
| `NODE_ENV` | `production` | Production mode |

### 6. Run Database Migrations
After first deploy, run migrations via Railway CLI or shell:
```bash
# Using Railway CLI
railway run psql $DATABASE_URL -f db/schema.sql
railway run psql $DATABASE_URL -f db/migrations/001_arena_economics_and_risk_features.sql
railway run psql $DATABASE_URL -f db/migrations/002_change_user_id_to_text.sql
railway run psql $DATABASE_URL -f db/migrations/003_add_atomic_participant_update.sql
railway run psql $DATABASE_URL -f db/migrations/004_per_agent_tick_intervals.sql
railway run psql $DATABASE_URL -f db/migrations/005_fix_cascade_delete_agents.sql
```

Or use Railway shell:
1. Go to Cerebellum service → "Connect" → "Open Shell"
2. Run migrations directly

### 7. Build Settings
Railway auto-detects Node.js:
- **Build Command**: `npm run build`
- **Start Command**: `npm start`

### 8. Domain & Networking
1. Generate a Railway domain: `cucumber-cerebellum-production.up.railway.app`
2. This URL is used by:
   - cucumber-web (`NEXT_PUBLIC_API_URL`)
   - cucumber-cortex (`CEREBELLUM_URL`)
   - cucumber-admin (`NEXT_PUBLIC_API_URL`)

### Private Networking (Optional)
For internal service communication, use Railway's private network:
- Private URL: `cerebellum.railway.internal:3001`
- Only accessible within the same Railway project
- Reduces latency and costs for Cortex → Cerebellum calls

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
