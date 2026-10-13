# Prioritized roadmap

Proposal only; no implementation, deployment, cleanup or dependency change was made. Estimate ranges in [findings](technical-findings.md) overlap. The product's usage/SLOs and actual hosting must be established before scheduling production changes.

## Technical implementation order

| Order | Scope / finding IDs | Why now and dependencies | Acceptance evidence / regression risk |
| --- | --- | --- | --- |
| 0 | Approve an isolated regression environment; AUD-026. Establish deployment exposure/retention owners. | Enables reliable checks without real data/mail/provider access. No production investigation was performed in the audit. | Disposable SQL/vector/files, network denied by default, deterministic fixtures. Do not repurpose existing configured test scripts without isolation. |
| 1 | Identity and access boundary: AUD-001, AUD-002; purpose/attempt fixes AUD-003/AUD-025; cloud atomicity AUD-010 | Highest impact; Google verification must ship with real authentication. Atomic OTP work depends on transaction semantics. | Anonymous/cross-user/guest/admin allow-deny matrix on every API and download; valid/invalid Google claims; OTP failure/expiry/reuse/concurrency on both SQL modes. High migration risk across clients/legacy data. |
| 1, parallel workstream after approval | File/content/deployment boundaries: AUD-004/005/006/011/012/031 | Independent high-impact paths; file handling can affect confidentiality and service availability. | Containment across OS encodings; owned asset resolution; blocked internal/untrusted URLs; bounded hostile file fixtures; clean build context; supported patched dependencies. No production payloads. |
| 2 | Data lifecycle: AUD-007/008/009/014/021, informed by AUD-010 | Prevent deletion failures/data loss before migrating or expanding usage. Agree retention scope first. | Repeated create preserves rows; clear cannot revive history; expired/deleted fixtures disappear from all intended stores; failures retry without orphaning or deleting unrelated vectors. Historical cleanup requires separate review/approval. |
| 3 | Core client/stream contracts: AUD-016/017/018/019/020/028/029/030 | High user impact; owned IDs/storage/lifecycle must be stable first. SSE parser fix can be implemented earlier in isolation. | Every frame split parsed; no cross-chat late updates; canonical reply jumps after reload; cross-session document attach actually grounds retrieval; library works local/R2 and web/native. |
| 4 | Grounding and resource control: AUD-013/015/022/023/024 | Restore answer trust and establish measured limits. Can develop evaluation fixtures alongside earlier stages. | Route corpus, late-page retrieval, missing-source honesty, no mixed embedding spaces, bounded file/history/concurrency, latency under representative load. Avoid unmeasured infrastructure expansion. |
| 5 | Reproducibility and maintainability: AUD-027/032/033 | Lock tested behavior and reduce future drift. Docker exclusions/PDF advisories are already early priorities; remaining lock/config/docs work follows. | Reproducible supported builds; fail-fast cloud config; API contract validation; factual README; focused modules with behavior tests. |

All 33 findings are covered above; “parallel workstream” describes scheduling options for the human team, not delegated agents used during this review.

P0 AUD-001 blocks confidence in untrusted multi-user deployment. P1 priorities reflect impact plus source evidence. Likely findings AUD-017/030/031 need controlled reproduction before estimating their exact affected scenarios, while simple preventive boundaries may still be appropriate.

## Product capability order

1. PRD-005: offline contract and grounding evaluation fixtures, supporting all technical work.
2. PRD-003: trustworthy signed-in/guest/temporary behavior, built on stages 1–2.
3. PRD-002: reliable chat stop/retry/errors/replies, after stream/ID contracts.
4. PRD-001: visible ingestion and actual document scope, after indexing/association/lifecycle.
5. PRD-004: native recovery and full history search; PRD-006: redacted readiness/operational visibility.
6. Validate HYP-001 before full-book summaries/source reader work; validate HYP-002/003/004 before export, offline continuity, voice or camera expansion.

See [product recommendations](product-recommendations.md) for benefit, effort, dependencies and risks. Product hypotheses are not approved requirements.

## Simplification order

- First address SIM-004 public global deletion and SIM-005 misleading fallback contracts as part of security/reliability repairs.
- Next validate SIM-001/002/003 consumers/build effects, then consider small removals/consolidations.
- Apply SIM-006 incrementally after tests; preserve platform-specific presentation and working architecture.

No removal is justified solely by a low reference count. Confirm external/admin consumers and product plans first.

## Review gates and operational unknowns

Before rollout, verify actual production dependency versions, exposure, persistent volumes, backup/restore and provider models/quotas through an authorized process. Test migrations/backfills on disposable copies; do not run this audit's scripts against production. Define latency/concurrency/file-size expectations before deciding on queues, additional workers or shared caches.

Implementation starts only after user approval of scope. The audit itself ends with documentation and explicitly recorded gaps, not silent feature changes.

