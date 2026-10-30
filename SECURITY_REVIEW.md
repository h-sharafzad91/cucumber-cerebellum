# Cucumber Cerebellum — Security Review

> Status: preliminary source-code review, not a penetration test or formal audit. Findings are based on the checked-in source at the reviewed revision. No deployment configuration, live environment, or production traffic was inspected.

## Scope

- Fastify server registration and CORS configuration
- Agent, round, arena and scheduler API routes
- Transaction signer and execution engine
- Action validation and risk controls
- Settlement and payout recording

## Findings

### High — state-changing API routes have no authentication or authorization layer in the server registration

**Affected:** `src/api/server.ts`, `src/api/routes/agents.ts`, `src/api/routes/rounds.ts`, `src/api/routes/arena.ts`

The server registers the application routes without a visible authentication or authorization hook. The same server exposes state-changing operations such as agent creation/update/deletion, joining rounds, starting/stopping rounds, triggering ticks and settlement. The server binds to `0.0.0.0` in `src/index.ts`.

If this service is reachable from an untrusted network, callers may be able to invoke operations that should be restricted to an authenticated user, an agent owner, or an operator. CORS is not an access-control mechanism; the configured `origin: true` only reflects request origins and does not authenticate callers.

**Recommendation:**
- Define explicit trust boundaries for public user APIs, internal service-to-service APIs, and operator-only APIs.
- Add authentication and per-resource authorization before enabling external access.
- Restrict scheduler controls, round lifecycle operations, and settlement to an operator identity.
- Verify ownership before allowing an agent's owner to read or mutate that agent.
- Restrict internal routes at the network layer as defence in depth.

### High — scheduler tick trigger is exposed without an operator guard

**Affected:** `GET /scheduler/status`, `POST /scheduler/tick`

The server registers these routes directly. The POST route invokes `tickScheduler.triggerTick()` and has no visible authentication check in the route or server registration. If externally reachable, an arbitrary caller could trigger scheduler work outside the normal schedule.

**Recommendation:** make scheduler diagnostics read-only for authorized operators and protect manual tick triggers with a dedicated operator permission and rate limit.

### High — agent APIs do not enforce ownership in the route layer

**Affected:** `src/api/routes/agents.ts`

The list route accepts an optional `user_id`; when omitted, it returns all agents. The create route accepts a caller-supplied `user_id`. Update and delete routes use only the agent ID and do not visibly check that the requester owns the agent. This becomes an IDOR / broken object-level authorization risk if the API is exposed to end users without an upstream authorization layer.

**Recommendation:** derive the user identity from the authenticated principal, never trust a body/query `user_id` as proof of ownership, and enforce ownership checks on every read/write by agent ID.

### Medium — production mode can still default to paper trading

**Affected:** `src/config/index.ts`

`PAPER_TRADING` defaults to the string `true`, and the runtime interprets only the exact string `'true'` as paper trading. This is a safe default for execution mode, but the deployment configuration should explicitly set and verify it. A mismatch between operator expectations and the effective mode can create misleading trade records or unexpected live execution if the setting is changed without a controlled release.

**Recommendation:** log the effective execution mode at startup, require explicit configuration in production, and add a startup guard requiring an explicit acknowledgement before live execution.

### Medium — transaction signer accepts a generic transaction request

**Affected:** `src/services/signer.ts`

`signAndSend` forwards transaction fields supplied by its caller to the wallet client. The current execution engine constructs a fixed router/token transaction, but the signer itself does not enforce an allowlist of destinations, selectors, value limits, or chain ID. A future call site or compromised internal component could expand the signing surface.

**Recommendation:** constrain signing to typed, purpose-specific operations; enforce chain ID, destination and function selector allowlists; cap native value and gas; and keep signer access private to the execution module.

### Medium — settlement marks internal payout records as completed

**Affected:** `src/services/settlement-engine.ts`

The settlement routine inserts payout rows with `payment_status: 'completed'` and `payment_method: 'internal'`. The reviewed method records internal accounting entries; it does not itself demonstrate an on-chain transfer or external payment. Downstream UI or reporting must not present these records as cash or token transfers unless a separate payout processor confirms them.

**Recommendation:** distinguish `calculated`, `recorded`, `processing`, `paid`, and `failed` states, and only mark a payout as paid after independently verifying the transfer or ledger operation.

## Required validation and tests

1. Unauthenticated requests cannot create, update, delete, or enumerate private agents.
2. A user cannot access another user's agent by changing an agent ID.
3. Only authorized operators can start, pause, stop, settle, or manually tick a round.
4. Public and internal service endpoints have separate authentication policies.
5. CORS allowlists are explicit in production; tests prove CORS is not relied on as authentication.
6. Signer rejects wrong chain IDs, unknown destinations, unknown selectors, and excessive values.
7. Settlement is idempotent and payout state reflects actual payment completion.
8. Production startup fails safely if live trading is requested without explicit acknowledgement.

## Validation status

- Source-level review only.
- Build and type-check: not run.
- Automated tests: not run.
- Runtime/API penetration testing: not run.
- Production deployment configuration: not inspected.
- No changes to runtime code are included in this review document.

Do not treat this document as a formal security audit or production approval.
