# Agent Warrant Protocol: Product Requirements

Status: Draft for implementation

Version: 0.1

Date: 2026-09-03

Target: DevNetwork API + Cloud + AI Hackathon 2026

## 1. Product summary

Agent Warrant Protocol is a human-authorization layer for high-risk AI agent actions. It converts an agent's proposed action into a narrowly scoped, expiring, single-use warrant. A human reviews and signs the warrant. The backend verifies the signature state and executes only the exact action bound to the signed warrant.

The hackathon MVP demonstrates one action: updating one DNS record on a preconfigured name.com sandbox domain.

## 2. Problem statement

AI agents increasingly receive credentials that let them change external systems. Existing authorization mechanisms are too broad for actions whose parameters are created dynamically:

- A service-account permission proves that an agent may edit DNS in general.
- A prompt records informal intent but is not an exact execution contract.
- A confirmation dialog may not preserve the payload shown to the user.
- A provider audit log proves that a call occurred but not that the person approved those parameters.
- A delayed action may remain technically authorized after the target state has changed.
- An agent that can both propose and approve an action defeats separation of duties.

The product must bind a human's signature to one canonical action payload and enforce that binding at execution time.

## 3. Product principles

1. **No ambient authority:** the AI never holds credentials for the action provider.
2. **Exact scope:** authorization includes the action, resource, before-state, after-state, expiry, and nonce.
3. **Human-only approval:** the agent cannot create a valid signature or mark its own warrant authorized.
4. **Fail closed:** missing, stale, malformed, duplicated, or unverifiable state stops execution.
5. **One-way state transitions:** terminal warrant states do not return to an executable state.
6. **Replay resistance:** one successful execution atomically consumes the warrant.
7. **Evidence before claims:** the receipt distinguishes proposed, signed, requested, and observed values.
8. **No security theater:** the PDF is evidence; backend policy checks enforce the capability.

## 4. Target users

### Primary user: incident operator

An SRE, IT administrator, or small-company technical lead who asks an AI assistant to make a time-sensitive infrastructure change but must retain human control.

Needs:

- understand exactly what will change;
- approve from one clear screen;
- avoid copying values between chat, ticketing, and DNS consoles;
- know that the action cannot exceed approval;
- produce evidence for a later incident review.

### Secondary user: security reviewer

A security, compliance, or platform-engineering lead who defines which agent actions require warrants and reviews the execution trail.

Needs:

- see who proposed, approved, and executed an action;
- verify that execution matched the signed payload;
- detect replays, stale preconditions, and provider errors;
- export a machine-readable and human-readable receipt.

## 5. Core job to be done

When an AI proposes a consequential external action, let a person authorize exactly that action for a short period and let the system prove that nothing broader was executed.

## 6. Demo scenario

The fixed demonstration uses a sandbox domain and record owned by the team.

Initial state:

```text
status.<sandbox-domain> CNAME normal-status-page.example.
```

Operator request:

```text
Switch the status subdomain to emergency-status-page.example now.
```

Proposed action:

```json
{
  "action_type": "dns.record.update",
  "domain": "<sandbox-domain>",
  "record_id": 12345,
  "record_type": "CNAME",
  "host": "status",
  "expected_current_answer": "normal-status-page.example.",
  "proposed_answer": "emergency-status-page.example.",
  "ttl": 300,
  "max_executions": 1,
  "expires_in_seconds": 600
}
```

Expected outcome:

1. The user sees a before-and-after diff and risk explanation.
2. Foxit creates the warrant PDF and eSign envelope.
3. The human signs the warrant.
4. The backend verifies the completed envelope directly with Foxit.
5. The system atomically reserves the warrant's one permitted execution.
6. The backend verifies that the live DNS record still matches the signed precondition, then calls name.com.
7. The system re-reads the record and creates an execution receipt.
8. A replay attempt fails with `WARRANT_ALREADY_CONSUMED`.

## 7. MVP scope

### Included

- One web experience for a preconfigured demo operator.
- One agent identity.
- Plain-language intent input.
- AI-produced structured proposal constrained by a server-owned JSON schema.
- Server-side allowlist validation.
- Live read of the selected name.com sandbox DNS record.
- Canonical warrant JSON and SHA-256 action digest.
- Human-readable warrant PDF generated with Foxit document tooling.
- One Foxit eSign envelope and one human signer.
- Embedded or linked Foxit signing experience.
- Server-side Foxit envelope-status verification.
- One exact DNS record update through name.com sandbox.
- Read-after-write verification through name.com.
- Warrant and execution state machines in Xano.
- Append-only, hash-linked audit events.
- Human-readable receipt page.
- Downloadable JSON receipt.
- Explicit demo of replay rejection.

### Excluded

- Production DNS zones.
- Domain purchase or transfer.
- Arbitrary DNS zones or record selection.
- Shell, cloud, payment, database, email, or deployment actions.
- General MCP proxying.
- Multiple agents, organizations, roles, or signers.
- Threshold signatures or multi-party approval.
- Cryptocurrency, blockchain, smart contracts, or decentralized storage.
- Custom policy authoring UI.
- Automatic rollback after the demo.
- Legal claims that a Foxit signature alone creates non-repudiation.
- A production-grade key-management system.

## 8. User journey

### Stage A: propose

1. The operator enters a plain-language request.
2. The product sends the request and server-owned action schema to the model.
3. The model returns a candidate `dns.record.update` proposal.
4. The backend rejects unknown action types, domains, records, hosts, or record types.
5. The backend reads the current record from name.com and replaces any model-supplied before-state with the provider-observed value.
6. The UI shows the proposal as untrusted and unapproved.

### Stage B: issue warrant

1. The operator confirms that the proposal should become a warrant.
2. The backend constructs canonical action and authorization JSON using deterministic field ordering and normalization rules.
3. The backend creates a random nonce and ten-minute expiry.
4. The backend calculates `action_digest` over the executable action and `warrant_digest` over the authorization envelope.
5. Foxit generates a PDF containing all authorization fields and both digests.
6. Foxit eSign creates an envelope for the expected signer.
7. The warrant moves from `DRAFT` to `PENDING_SIGNATURE`.

### Stage C: authorize

1. The signer reviews the PDF and signs or declines.
2. Foxit redirects or notifies the backend.
3. The backend treats the callback as a prompt to verify, not proof of completion.
4. The backend queries Foxit using server credentials.
5. If the expected envelope is complete, the backend retrieves the signed document, hashes it, and moves the warrant to `AUTHORIZED`.
6. Declined, cancelled, expired, or mismatched envelopes cannot authorize execution.

### Stage D: execute

1. The operator requests execution.
2. The backend validates the warrant, expiry, signer, digest, nonce, scope, and state.
3. The backend atomically moves the warrant from `AUTHORIZED` to `EXECUTING`, consuming its one allowed execution.
4. The backend reads the current DNS record again.
5. If the current answer differs from the signed precondition, execution moves to `FAILED` with `PRECONDITION_CHANGED`; no provider mutation occurs and the warrant cannot be reused.
6. The backend calls the exact name.com update operation represented by the warrant.
7. The backend re-reads the record.
8. A matching observed result moves the warrant to `EXECUTED`.
9. A provider or verification failure moves it to `FAILED`; it never silently retries the mutation.

### Stage E: prove

1. The backend writes the final audit event.
2. It creates JSON and HTML receipts.
3. The UI shows proposed, signed, requested, and observed values separately.
4. A second execution request demonstrates that the consumed nonce cannot be reused.

## 9. Functional requirements

Priority meanings: P0 is required for the primary demo. P1 is required if the core path is stable. P2 is a stretch goal.

| ID | Priority | Requirement | Acceptance condition |
|---|---:|---|---|
| FR-001 | P0 | Accept a plain-language DNS-change request | A fixed demo request produces one schema-valid proposal or a visible validation error |
| FR-002 | P0 | Restrict proposals to the configured sandbox target | A different domain, record ID, action type, or unsupported record type is rejected server-side |
| FR-003 | P0 | Read the current DNS state from name.com | The proposal screen displays the provider-observed record, not an AI assertion |
| FR-004 | P0 | Render an exact before-and-after diff | Domain, host, type, TTL, old answer, and new answer are visible before warrant creation |
| FR-005 | P0 | Create canonical warrant data | Identical normalized inputs produce the same action digest |
| FR-006 | P0 | Generate a warrant PDF using Foxit | The PDF includes action and warrant digests, scope, signer, expiry, nonce, old value, and new value |
| FR-007 | P0 | Send the warrant through Foxit eSign | The expected signer can open and complete the signing flow |
| FR-008 | P0 | Verify signing server-side | A browser redirect alone cannot set a warrant to `AUTHORIZED` |
| FR-009 | P0 | Enforce expiry | Execution after `expires_at` fails without calling name.com |
| FR-010 | P0 | Enforce single use | A successful warrant cannot enter `EXECUTING` a second time |
| FR-011 | P0 | Enforce optimistic precondition | A changed live DNS answer causes `PRECONDITION_CHANGED` and no mutation |
| FR-012 | P0 | Execute the exact signed mutation | The name.com request fields match the canonical signed payload exactly |
| FR-013 | P0 | Verify provider state after execution | Success is shown only after name.com returns the expected record on re-read |
| FR-014 | P0 | Preserve an audit chain | Every transition stores the previous event hash and its own deterministic hash |
| FR-015 | P0 | Produce an execution receipt | Receipt binds prompt hash, action digest, signed-PDF hash, provider result, and event-chain head |
| FR-016 | P0 | Display failures without pretending success | Every failed gate names its error and confirms whether the DNS mutation was attempted |
| FR-017 | P1 | Download receipt JSON | Downloaded JSON validates against the receipt schema documented in architecture |
| FR-018 | P1 | Show the signed warrant | Authorized and terminal warrant pages link to the retrieved signed artifact |
| FR-019 | P1 | Publish receipt digest as DNS TXT | After execution, an optional second approved operation creates a `_warrant` TXT proof record |
| FR-020 | P2 | Generate a PDF receipt | Foxit converts the final HTML receipt into a downloadable PDF |

FR-019 must not enter the P0 path unless it is included in the original signed action bundle. Publishing a TXT record is a second mutation and cannot be smuggled into the first authorization.

## 10. AI requirements

The model performs proposal drafting only.

### Input

- operator prompt;
- allowlisted domain, record ID, record type, and permitted action type;
- current provider-observed DNS record;
- fixed output schema;
- instruction to describe risk without claiming authorization.

### Output

- `action_type`;
- target fields;
- proposed value;
- concise urgency and timing context, without promising automatic rollback;
- concise rationale;
- risk summary;
- clarification question when intent cannot be represented safely.

### Validation

- Reject output that fails the JSON schema.
- Reject unknown or extra fields.
- Reject targets outside the allowlist.
- Ignore any AI-provided authorization state, signer identity, current value, nonce, timestamps, or digest.
- Never pass external API credentials to the model.
- Store model name, parameters, prompt version, input hash, output hash, and validation result.
- A deterministic prepared proposal may be used for recording only after one live model call succeeds and the fallback is disclosed.

## 11. Warrant requirements

A warrant must contain:

| Field | Source | Rule |
|---|---|---|
| `warrant_id` | Backend | UUID generated once |
| `version` | Backend | Fixed to `warrant.v1` for MVP |
| `agent_id` | Backend configuration | Cannot come from model output |
| `action_type` | Validated proposal | Must equal `dns.record.update` |
| `resource` | Backend allowlist plus provider read | Exact domain and record ID |
| `precondition` | name.com read | Exact current type, host, answer, TTL, and record ID |
| `effect` | Validated proposal | Exact replacement answer and TTL |
| `reason` | Operator plus AI draft | Human-readable, not used for execution equality |
| `signer_email_hash` | Backend configuration | Store hash in public receipt; private email remains restricted |
| `issued_at` | Backend clock | UTC ISO 8601 |
| `not_before` | Backend clock | Equal to or after issuance |
| `expires_at` | Backend policy | Ten minutes after issuance |
| `nonce` | Cryptographic random generator | At least 128 bits, single use |
| `max_executions` | Backend policy | Fixed to 1 |
| `action_digest` | Backend | SHA-256 over canonical executable fields |
| `warrant_digest` | Backend | SHA-256 over the authorization envelope that binds the action digest, agent, signer, expiry, nonce, and use limit |

The human-readable PDF and canonical JSON must display the same executable fields. The system must reject execution if the stored digest no longer matches a fresh canonicalization.

`expires_at` limits the authority to execute. It does not define the lifetime of the DNS effect. Restoring the prior DNS value requires a separate warrant.

## 12. State requirements

### Warrant states

```text
DRAFT
  -> PENDING_SIGNATURE
      -> AUTHORIZED
          -> EXECUTING
              -> EXECUTED
              -> FAILED
      -> DECLINED
      -> EXPIRED
      -> CANCELLED
```

Rules:

- `DRAFT` is editable but not executable.
- Creating a Foxit envelope freezes executable warrant fields.
- `AUTHORIZED` requires direct server-side verification with Foxit.
- Only `AUTHORIZED` can transition to `EXECUTING`.
- The `AUTHORIZED -> EXECUTING` transition must be atomic.
- `EXECUTED`, `FAILED`, `DECLINED`, `EXPIRED`, and `CANCELLED` are terminal in the MVP.
- A correction creates a new warrant with a new nonce and digest.

### Execution states

```text
NOT_STARTED -> RESERVED -> PROVIDER_ACCEPTED -> VERIFIED
                   |              |               ^
                   |              v               |
                   +------> RECONCILING -----------+
                   |              |
                   +-----------> FAILED <----------+
```

`PROVIDER_ACCEPTED` is not success. An ambiguous request enters `RECONCILING`; it never reopens the warrant. Only `VERIFIED` may produce an executed receipt.

## 13. Non-functional requirements

### Security

- Foxit, name.com, model, and Xano administrative credentials never reach the browser.
- Use the name.com sandbox base URL by default.
- Encrypt provider credentials using platform secrets.
- Log hashes or internal IDs instead of full signer email and prompt content where possible.
- Treat Foxit callbacks as untrusted until direct status verification succeeds.
- Rate-limit proposal, envelope creation, status verification, and execution endpoints.
- Apply an idempotency key to every external operation.
- Escape all user-controlled content before rendering HTML or PDF.
- Receipt downloads use unguessable identifiers or authenticated access.

### Reliability

- Duplicate callbacks must be safe.
- Duplicate execution requests must not produce duplicate provider mutations.
- External timeouts must produce an `UNKNOWN_PROVIDER_STATE` audit event and trigger re-read before any retry decision.
- No automatic mutation retry is allowed after an ambiguous timeout.
- All timestamps use UTC.
- The UI must recover from refresh using persisted state.

### Performance

- Proposal generation target: under 10 seconds.
- Warrant generation target: under 15 seconds, excluding user signing time.
- Status verification target: under 5 seconds after Foxit reports completion.
- DNS API execution and re-read target: under 10 seconds.
- The demo must not depend on public DNS propagation; provider API state is the verification source.

### Accessibility

- All critical states must be expressed in text, not color alone.
- Keyboard users must be able to review, sign-link, execute, and download.
- Risk and diff content must use readable labels rather than raw JSON alone.

## 14. Error contract

The UI and API must distinguish at least:

| Code | Meaning | Mutation attempted? | Recovery |
|---|---|---:|---|
| `PROPOSAL_INVALID` | Model output failed validation | No | Revise prompt or use prepared valid proposal |
| `TARGET_NOT_ALLOWED` | Requested resource is outside demo scope | No | Use configured sandbox target |
| `WARRANT_EXPIRED` | Authorization deadline passed | No | Issue a new warrant |
| `SIGNATURE_NOT_VERIFIED` | Foxit does not report completed envelope | No | Refresh or complete signing |
| `SIGNED_ARTIFACT_MISMATCH` | Signed artifact or envelope does not match warrant | No | Cancel and issue a new warrant |
| `PRECONDITION_CHANGED` | DNS changed after signing | No | Failed warrant remains consumed; review live state and issue a new warrant |
| `WARRANT_ALREADY_CONSUMED` | Nonce or warrant was already executed | No | Inspect original receipt |
| `EXECUTION_IN_PROGRESS` | Another request owns the atomic reservation | No additional mutation | Poll current execution |
| `PROVIDER_REJECTED` | name.com rejected the mutation | Yes | Inspect provider response; create new warrant if needed |
| `UNKNOWN_PROVIDER_STATE` | Request timed out after dispatch | Possibly | Re-read provider state; never blind-retry |
| `POSTCONDITION_FAILED` | Provider state does not match signed effect | Yes | Mark failed and investigate manually |

## 15. Analytics and evidence

Hackathon analytics must avoid collecting sensitive content. Track:

- proposal started, validated, or rejected;
- warrant created;
- signing session opened;
- signature verified, declined, or expired;
- execution requested, blocked, attempted, and verified;
- replay rejected;
- receipt viewed or downloaded;
- stage latency and error code.

The demo submission must disclose which provider calls are live and whether a prepared model response is used as a fallback.

## 16. Acceptance tests

### Happy path

1. Submit the fixed request.
2. Validate one exact proposal.
3. Generate and sign the warrant.
4. Verify authorization server-side.
5. Execute once.
6. Confirm name.com returns the new record.
7. Confirm receipt fields and audit hashes.

### Required negative tests

1. Modify the requested DNS answer after signing: digest validation rejects it.
2. Change the live DNS answer before execution: precondition check rejects it.
3. Forge a callback with a completed event: direct Foxit query prevents authorization.
4. Execute the same authorized warrant concurrently: exactly one request reserves it.
5. Execute the successful warrant again: replay is rejected.
6. Execute after expiry: no name.com mutation call occurs.
7. Request a different domain or record: allowlist rejects it.
8. Simulate a name.com timeout: system re-reads state and does not blind-retry.
9. Return schema-invalid AI output: no warrant is created.
10. Refresh the browser at every state: persisted workflow resumes correctly.

## 17. Success metrics

The hackathon prototype is successful when:

- a judge understands the authority problem within 20 seconds;
- one live prompt produces a constrained proposal;
- one human signs through Foxit;
- one name.com sandbox DNS record changes only after verified authorization;
- proposed, signed, requested, and observed values match;
- a replay attempt visibly fails;
- the complete path fits in a 2 to 4 minute video;
- Foxit, name.com, and Xano each perform work the product cannot replace with a static mock;
- the repository explains setup and trust boundaries without claiming production readiness.

## 18. Delivery plan

### Gate 0: credentials and API spike

- Create Foxit developer credentials and a test eSign flow.
- Create or confirm name.com sandbox credentials and target record.
- Create Xano workspace and authenticated API group.
- Save redacted request and response fixtures.
- Stop if signed-envelope verification or DNS update cannot be proven live.

### Phase 1: contract and state machine

- Freeze `warrant.v1` canonicalization rules.
- Create Xano tables and transition endpoints.
- Add allowlist and execution guards.
- Test atomic reservation and replay rejection.

### Phase 2: external adapters

- Implement name.com read, update, and re-read.
- Implement Foxit PDF generation, envelope creation, callback ingestion, direct verification, and artifact retrieval.
- Add idempotency keys and redacted provider logging.

### Phase 3: product flow

- Build prompt and proposal screen.
- Build warrant preview and signing transition.
- Build execution gate and receipt screen.
- Add visible blocked and failure states.

### Phase 4: demo hardening

- Rehearse happy path and all critical failure paths.
- Seed a known-good starting DNS record.
- Record a backup demo only after the live flow succeeds.
- Verify the Devpost repository, setup instructions, screenshots, and video links.

## 19. Open implementation questions

These must be answered by the API spike rather than assumed:

1. Which Foxit document-generation path produces the fastest warrant PDF: PDF Services MCP, Document Generation API, or HTML-to-PDF?
2. Which completed-envelope status and retrieval response should be treated as authoritative for the hackathon account?
3. Does the Foxit account support embedded signing without email delivery, and what expiry applies to the session URL?
4. Which name.com sandbox record types behave consistently for update and immediate API re-read?
5. Which Xano primitive provides the simplest atomic compare-and-set transition for `AUTHORIZED -> EXECUTING`?
6. Can the Xano static host serve the chosen frontend build, or should the frontend deploy separately while Xano remains the backend?

## 20. Related documentation

- [Project README](../README.md)
- [Technical Architecture](ARCHITECTURE.md)
