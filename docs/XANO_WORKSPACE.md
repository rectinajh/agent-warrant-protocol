# Xano workspace blueprint (MVP)

The Xano API group is currently empty (the only path is the stray `/XANO_API_BASE_URL`
endpoint). Provision the tables and endpoints below so the TypeScript protocol core
can persist warrants, reserve executions atomically, and keep a hash-linked audit chain.

This is the minimal P0 surface used by `XanoWarrantRepository`. Field types map to native
Xano types where available; all timestamps are UTC ISO-8601.

## Tables

### `warrants`

| Field                | Type      | Notes                                           |
| -------------------- | --------- | ----------------------------------------------- |
| `id`                 | uuid      | Primary key (warrant id)                        |
| `state`              | text      | Warrant lifecycle state (enum below)            |
| `state_version`      | integer   | Compare-and-set version                         |
| `execution_count`    | integer   | Starts at 0, max 1                              |
| `action_json`        | json      | Frozen executable payload                       |
| `authorization_json` | json      | Frozen authorization envelope                   |
| `action_digest`      | text      | SHA-256 hex                                     |
| `warrant_digest`     | text      | SHA-256 hex                                     |
| `nonce_sha256`       | text      | Hash of nonce, raw nonce never stored after use |
| `expires_at`         | timestamp | UTC                                             |
| `created_at`         | timestamp | UTC                                             |
| `updated_at`         | timestamp | UTC                                             |

Warrant states: `DRAFT`, `PENDING_SIGNATURE`, `AUTHORIZED`, `EXECUTING`, `EXECUTED`,
`FAILED`, `DECLINED`, `EXPIRED`, `CANCELLED`.

### `executions`

| Field                   | Type      | Notes                       |
| ----------------------- | --------- | --------------------------- |
| `id`                    | uuid      | Primary key                 |
| `warrant_id`            | uuid      | Unique for MVP              |
| `idempotency_key`       | text      | Unique per attempt          |
| `state`                 | text      | Execution lifecycle (below) |
| `requested_action_json` | json      | Frozen action               |
| `preflight_record_json` | json      | nullable, live pre-mutation |
| `observed_record_json`  | json      | nullable, read-after-write  |
| `error_code`            | text      | nullable                    |
| `started_at`            | timestamp | UTC                         |
| `completed_at`          | timestamp | nullable                    |

Execution states: `NOT_STARTED`, `RESERVED`, `PROVIDER_ACCEPTED`, `RECONCILING`,
`VERIFIED`, `FAILED`.

### `audit_events`

| Field                 | Type      | Notes                               |
| --------------------- | --------- | ----------------------------------- |
| `id`                  | uuid      | Primary key                         |
| `warrant_id`          | uuid      | Event stream key                    |
| `sequence`            | integer   | Unique within warrant               |
| `event_type`          | text      | Stable name                         |
| `actor_kind`          | text      | `human`/`agent`/`system`/`provider` |
| `actor_id`            | text      | Internal or provider id             |
| `before_state`        | text      | nullable                            |
| `after_state`         | text      | nullable                            |
| `metadata_json`       | json      | Redacted                            |
| `previous_event_hash` | text      | nullable, null for first            |
| `event_hash`          | text      | SHA-256 of canonical event          |
| `created_at`          | timestamp | UTC                                 |

The application must never expose update/delete on `audit_events`.

## Endpoints (same API group)

All paths are under `https://xcq6-dnqz-j5vz.n7e.xano.io/api:KAe04YzN` and require the
`Authorization: Bearer <token>` header.

| Method | Path                     | Purpose                                      |
| ------ | ------------------------ | -------------------------------------------- |
| POST   | `/warrants`              | Create or update a warrant (upsert by id)    |
| GET    | `/warrants/{id}`         | Read one warrant                             |
| GET    | `/warrants`              | List warrants                                |
| POST   | `/warrants/{id}/reserve` | Atomic `AUTHORIZED -> EXECUTING` reservation |
| PATCH  | `/executions/{id}`       | Set execution state and optional fields      |
| GET    | `/executions/{id}`       | Read one execution                           |
| GET    | `/executions`            | List executions                              |
| POST   | `/warrants/{id}/finish`  | Finish warrant (`EXECUTED`/`FAILED`)         |
| POST   | `/audit/events`          | Append one audit event (returns event)       |
| GET    | `/warrants/{id}/audit`   | Return the warrant's audit chain             |

### Atomic reservation

`POST /warrants/{id}/reserve` must be atomic. Use a Xano transaction or a conditional
update (`WHERE state = 'AUTHORIZED' AND state_version = ?`) so exactly one concurrent
request wins. On success it returns the updated warrant, the created execution row, and
`state_version + 1`. If the state or version no longer matches, return a conflict so the
client sees `state_conflict` or `version_conflict`.

Audit appends must be append-only and compute `event_hash` from the canonical event
record including `previous_event_hash`.

## Implementation notes (live)

The endpoints above have been created in API group `Agent Warrant API Group`
(canonical `KAe04YzN`) under `https://xcq6-dnqz-j5vz.n7e.xano.io/api:KAe04YzN`.

- **Timestamp handling.** Xano returns `timestamp` columns and inputs as epoch
  milliseconds, not ISO-8601 strings. The `protocol` expects UTC ISO-8601, so the
  `executions.started_at` / `executions.completed_at` and
  `audit_events.created_at` columns are stored as **text** (ISO strings) so they
  round-trip unchanged. `warrants.created_at` / `updated_at` / `expires_at` remain
  native timestamps because they are only used internally (the API responses expose
  the ISO strings inside `authorization_json`, never the column).
- **Nullables.** `executions.preflight_record_json`, `observed_record_json`,
  `error_code`, `completed_at` and `audit_events.before_state`, `after_state`,
  `previous_event_hash` are nullable so "not yet set" round-trips as `null` (Xano
  otherwise coerces an omitted nullable to `""`/`0`).
- **Audit hash authorship.** Xano has no usable SHA-256 primitive, so
  `XanoWarrantRepository.appendAudit` computes `sequence` / `previous_event_hash` /
  `event_hash` locally with the same canonical SHA-256 used by `verifyAuditChain`,
  then posts the complete event to `POST /audit/events`, which is strictly
  append-only. This keeps the returned chain verifiable by the TS verifier.
- The `executionRecord` / timestamp schemas accept both an ISO-8601 string and an
  epoch-millisecond number (normalized to ISO) so the client is robust regardless of
  how Xano serializes a timestamp on a given deployment.
- **Warrant persistence.** `POST /warrants` is an upsert by `id` that stores the
  frozen `action_json` / `authorization_json` plus flat digests and lifecycle fields.
  `WarrantRepository.saveWarrant` backs it, and both `issueWarrantForSignature` and
  `authorizeSignedWarrant` accept an optional `repository` so the issued and signed
  states are written back as they transition.
