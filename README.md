# Cucumber Cerebellum

Backend orchestration service for Cucumber Trade Arena.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Environment Variables

See `.env.example` for required configuration.

## API Endpoints

- `GET /health` - Health check
- `GET /v1/agents` - List agents
- `POST /v1/agents` - Create agent
- `GET /v1/rounds` - List rounds
- `POST /v1/rounds` - Create round
- `POST /v1/rounds/:id/start` - Start round
- `POST /v1/arena/:roundId/action` - Submit action
- `GET /v1/leaderboard/:roundId` - Get leaderboard

## WebSocket Events

- `subscribe:round` - Subscribe to round updates
- `tick` - Receive tick data
- `trade` - Receive trade updates
- `leaderboard` - Receive leaderboard updates
