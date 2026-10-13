# Product recommendations and simplification candidates

Baseline: 2026-10-12. These are proposals, not implemented features or invented requirements. Technical defects remain defined by AUD IDs in [findings](technical-findings.md). Priorities below are product priorities, separate from technical severity.

## Evidence-backed capabilities to complete

| ID / priority | Problem and evidence | Benefit / high-level implementation | Complexity / dependencies / risks |
| --- | --- | --- | --- |
| PRD-001 / P1 | Users cannot reliably tell whether a document is indexed, which document grounds an answer, or whether library attachment succeeded (AUD-014/015/018/021/022). Historical data/issues also reports weak book grounding. | Show upload/parse/index/ready/failed states; display actual server-linked document scope and page/source details; enable retry for failed ingestion. | Medium, ~4–7 days after contract fixes. Depends on ingestion status and owned document association. Risk: do not report ready before durable indexing; scanned-PDF detection should say no text, not fabricate coverage. |
| PRD-002 / P1 | Lost/partial streams and reply jumps lack stable protocol semantics (AUD-016/017/028/030). | Reliable stop/retry and visible failed/partial state; canonical message IDs and idempotent turn IDs; reconcile server history with displayed state. | Medium, ~4–6 days; backend + both clients. Risk: retry can duplicate turns/provider cost unless idempotency is defined. Durable resume is a later hypothesis, not required for the first fix. |
| PRD-003 / P1 | Account state is not authenticated; privacy promises exceed actual retention (AUD-001/002/007/008). | A real signed-in session with logout/revocation and clear guest/temporary disclosures; user-visible deletion state tied to actual lifecycle. | High, built on security/lifecycle roadmap, not an independent cosmetic feature. Dependencies: principal/ownership and all-store cleanup. Risk: migrating legacy sessions/assets and irreversible deletion. |
| PRD-004 / P2 | Native app lacks web-equivalent recovery and searches only loaded chats; outages look like empty history (AUD-029). | Add password-reset/resend flow and server-side history search, with explicit loading/error/retry/empty states. | Medium, ~2–4 days after stable auth APIs. Dependencies: safe OTP, debounced pagination, device tests. Risk: account enumeration, late-result mixing and mail delivery failures. |
| PRD-005 / P1 | Existing verification uses live configured services and weak assertions (AUD-026); client contract drift is already visible. | Offline regression fixtures and an internal answer-quality/routing dataset spanning late PDF pages, no-text PDFs, failed search, reply IDs, provider failures and chunk splits. | Medium, ~4–7 days, can start before implementation. No new framework required initially. Risk: overfitting assertions to generated prose; prefer route/retrieval/source and lifecycle invariants. |
| PRD-006 / P2 | Silent fallbacks and shallow health response hide operational failures (AUD-013/020/023/027). | Readiness/config checks; request/turn correlation; latency/error/fallback counters; bounded upload/model budgets; actionable operator runbook. | Medium, ~3–5 days. Requires agreed SLOs and log redaction. Risk: never collect prompt/file content by default or reveal secrets through health endpoints. |

## Product hypotheses requiring validation

| ID / priority | Hypothesis and evidence limits | Benefit / implementation sketch | Complexity / dependencies / risks |
| --- | --- | --- | --- |
| HYP-001 / P2 | Readers may need full-document summaries and passage navigation rather than only top-K question answering. data/issues and summary starters suggest this, but usage is unknown. | Define a summary workflow with chapter/page coverage and citations, or a source reader that opens cited pages. Measure comprehension/task success first. | Medium–high; depends on PRD-001 and a quality dataset. Risk: context cost, latency, scanned PDFs and false completeness claims. Do not replace RAG wholesale. |
| HYP-002 / P2 | Users may value conversation/export portability and account-wide deletion status; no explicit demand is recorded. | Export owned history/attachments in a stable format; expose deletion scope and completion after reliable lifecycle work. | Medium; identity, ownership and retention must precede it. Risk: accidental bulk disclosure, external links expiring, incomplete deletion semantics. |
| HYP-003 / P3 | Cross-device draft continuity or offline reading may improve mobile usability; requirements are not established. | First validate demand, then cache bounded owned history/drafts with explicit sync/error state. | High relative to current defects. Depends on canonical IDs/auth/lifecycle. Risk: device data retention, conflicts, stale provider answers. |
| HYP-004 / P3 | Voice/camera may be desirable; voice appears as a historical idea and README implies broader capture. | Validate actual tasks and native permissions before a small capture/transcription prototype. | Medium–high; providers, permissions, privacy, costs and accessibility. Defer until core chat reliability is measured. |

## Simplification / removal candidates

No candidate was removed. Static reference absence is not evidence that external consumers or intended product plans do not exist.

| ID / priority / proposed disposition | Evidence and dependencies | Potential benefit | Removal/change risk and prerequisite |
| --- | --- | --- | --- |
| SIM-001 / P3 / consider remove or consolidate | Web DocumentDropzone.tsx, ModeSelector.tsx and CitationsBox.tsx have definitions but no tracked consumers found. Active composition uses other input/mode/source UI. | Reduce duplicate UI paths and future maintenance. Low complexity (<1 day after validation). | Search all references/exports and check planned use/external imports. Visual comparison before replacing active components. No business usage claim made. |
| SIM-002 / P3 / correct or retire unused helper | mobile/src/services/api.ts:getSessionDocuments calls nonexistent /document/session/{id}; no caller found. Active history already returns documents. | Remove a misleading API contract or align it with /document/list if needed. Low complexity. | Confirm no dynamic/external use; preserve expected return shape if retained. Not reported as a currently exercised failure. |
| SIM-003 / P3 / consolidate generated config | Tracked frontend/vite.config.js duplicates vite.config.ts; composite tsc can emit JS. | One source of configuration and less stale build drift. Low complexity, ~1 day with build validation. | Establish which config Vite resolves and how tsc emits before deleting anything. Build writes artifacts and was not run in this audit. |
| SIM-004 / P1 / restrict or retire public admin-like API | /document/clear-all is global and unauthenticated; no normal client workflow was found (AUD-001). | Remove a broad deletion capability from the public product surface. Low–medium implementation effort. | External/manual consumers may exist; identify admin recovery needs. If retained, require explicit privileged authorization and confirm scope. |
| SIM-005 / P2 / simplify misleading fallback chains | Hash embeddings, fabricated search entries and R2-to-local URL fallback pretend successful continuity (AUD-015/020/023). | Honest failure states and fewer inconsistent states. Medium complexity across providers. | Retain useful local/cloud adapters; do not remove offline/local development support merely because cloud is used. Make fallback intentional and testable. |
| SIM-006 / P3 / consolidate duplicate state/contracts | Both App components and clients hand-maintain overlapping rules; web session hook and App also overlap fetching responsibilities (AUD-033). | Reduce future web/native drift and late-result bugs through small tested modules/contracts. | Medium complexity; do not share platform UI/runtime packages indiscriminately. First establish behavior tests, then extract one responsibility at a time. |

## Retain and validate rather than replace

Retain document/web/general/image modes, reply references, citations, history/pins, temporary/guest choices, attachment library and local/cloud deployment options pending business validation. Their implementation defects do not establish that the features themselves are unnecessary.

Preserve parameterized SQL, Pydantic validation, web session debounce/paging, native FlatList, citation page metadata, explicit service boundaries and typed transport code. No evidence supports switching frameworks, moving to microservices, removing a datastore family or replacing every state hook with a new library.

## Decisions needed before scope commitment

Agree intended trust model and guest permissions; retention/deletion promises including provider handling; workload/file-size budgets; required platforms; local versus cloud support obligations; source-quality acceptance criteria; and actual use of administrative/legacy surfaces. Obtain these decisions before irreversible cleanup or feature removal. They do not prevent documenting and prioritizing confirmed defects now.

