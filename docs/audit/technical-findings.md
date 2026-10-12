# Technical findings

Reviewed 2026-10-12 against `0c7cd717c262b4fd5afcd1d785815cb53066c85e`. No fixes implemented.

## Interpretation

**33 findings: 1 P0 Critical, 15 P1 High, 15 P2 Medium, 2 P3 Low.** Severity expresses product impact if the relevant path/configuration is used; it is not a claim that production has been exploited. Confirmed means source behavior or an isolated reproduction is established; Likely means the impact needs an integration reproduction. Runtime uncertainties are explicit. No finding here certifies production exposure.

Effort estimates are rough engineer-days including focused tests, excluding production migration/incident response; estimates overlap and should not be summed. [Verification](verification.md) separates prior executed checks from static tracing. [Coverage](../review-coverage.md) records all exclusions. IDs survived the interruption and are used across the roadmap.

| ID | Severity | Confidence | Finding |
| --- | --- | --- | --- |
| [AUD-001](#aud-001) | P0 Critical | Confirmed | API lacks authenticated identity and ownership enforcement |
| [AUD-002](#aud-002) | P1 High | Confirmed | Google login accepts forged identity claims |
| [AUD-003](#aud-003) | P1 High | Confirmed | SQLite rolls back failed OTP attempt accounting |
| [AUD-004](#aud-004) | P1 High | Confirmed | SPA fallback permits paths outside its static root |
| [AUD-005](#aud-005) | P1 High | Confirmed | Upload paths use untrusted IDs and filenames |
| [AUD-006](#aud-006) | P1 High | Confirmed | Media attachments permit arbitrary HTTP fetches and local reads |
| [AUD-007](#aud-007) | P1 High | Confirmed | Temporary/guest deletion is incomplete across stores |
| [AUD-008](#aud-008) | P1 High | Confirmed | Cleared messages return through the process cache |
| [AUD-009](#aud-009) | P1 High | Confirmed | Repeated create destroys existing session children |
| [AUD-010](#aud-010) | P1 High | Confirmed | Turso adapter has no transaction semantics |
| [AUD-011](#aud-011) | P1 High | Confirmed | Docker context can copy secrets/runtime media |
| [AUD-012](#aud-012) | P1 High | Confirmed | Installed pypdf falls in resource-exhaustion advisory ranges |
| [AUD-013](#aud-013) | P1 High | Confirmed | Synchronous work blocks asynchronous request execution |
| [AUD-014](#aud-014) | P1 High | Confirmed | Dimension mismatch recovery deletes the shared vector collection |
| [AUD-015](#aud-015) | P2 Medium | Confirmed | Hash embedding fallback mixes unrelated vector spaces |
| [AUD-016](#aud-016) | P1 High | Confirmed | Mobile SSE drops events split across progress callbacks |
| [AUD-017](#aud-017) | P2 Medium | Likely | In-flight client work is not scoped to conversation transitions |
| [AUD-018](#aud-018) | P2 Medium | Confirmed | Library document attachment updates only client state |
| [AUD-019](#aud-019) | P2 Medium | Confirmed | Generated/mobile media omit the owner used by library filters |
| [AUD-020](#aud-020) | P2 Medium | Confirmed | Storage fallback and reference-image resolution disagree |
| [AUD-021](#aud-021) | P2 Medium | Confirmed | Ingestion is non-atomic and uses filename-based object keys |
| [AUD-022](#aud-022) | P2 Medium | Confirmed | Intent heuristics bypass grounding and over-trigger image generation |
| [AUD-023](#aud-023) | P2 Medium | Confirmed | Search failure is presented as evidence; sources are snippet-only |
| [AUD-024](#aud-024) | P2 Medium | Confirmed | Histories, uploads and process caches are unbounded |
| [AUD-025](#aud-025) | P2 Medium | Confirmed | OTP purposes and delivery outcomes are conflated |
| [AUD-026](#aud-026) | P2 Medium | Confirmed | Verification scripts are unsafe as a default regression suite |
| [AUD-027](#aud-027) | P2 Medium | Confirmed | Build/deployment lacks reproducibility and fail-fast validation |
| [AUD-028](#aud-028) | P2 Medium | Confirmed | Reply targets use client IDs that change on reload |
| [AUD-029](#aud-029) | P2 Medium | Confirmed | Mobile history/search/server configuration hides failures |
| [AUD-030](#aud-030) | P2 Medium | Likely | Streaming retries and terminal events can hide partial failure |
| [AUD-031](#aud-031) | P1 High | Likely | Active image formats are served on the application origin |
| [AUD-032](#aud-032) | P3 Low | Confirmed | README and comments overstate verified behavior |
| [AUD-033](#aud-033) | P3 Low | Confirmed | Large orchestration components and duplicate contracts increase change risk |

<a id="aud-001"></a>

## AUD-001: API lacks authenticated identity and ownership enforcement

- **Category / severity / confidence:** Security · P0 Critical · Confirmed.
- **Location:** backend/app/main.py:26; backend/app/api/v1/endpoints/{user,session,document,media,chat}.py.
- **Evidence and cause:** All six routers and clients were traced. No token/session issuance or authentication dependency exists. user_id/session_id are caller claims; GET /media/assets without filters is global; POST /document/clear-all is global; static media is public.
- **Impact:** Any reachable untrusted caller can access/alter other users' resources and consume provider capacity. P0 is a blocker for untrusted multi-user exposure, not proof of a production breach.
- **Verification:** Static router/middleware/schema/client trace. No deployed API was contacted; an external gateway could affect exposure but would not supply missing per-resource ownership in this code.
- **Recommendation:** Establish server-verified sessions/tokens, derive owner from the principal, enforce an allow/deny matrix on every resource/download, and separately define restricted guest/admin capabilities.
- **Estimated effort:** 5–10 days.
- **Regression risk:** High: both clients, guest flows, existing assets and sessions must migrate together.

<a id="aud-002"></a>

## AUD-002: Google login accepts forged identity claims

- **Category / severity / confidence:** Authentication · P1 High · Confirmed.
- **Location:** backend/app/services/user_service.py:39,838; frontend/src/components/Modals/UserModal.tsx:handleGoogleSignInClick; backend/verify_google_auth.py.
- **Evidence and cause:** parse_google_id_token decodes the JWT without signature/audience/issuer/expiry verification. authenticate_with_google accepts plain req.email when credential is absent and selects existing users. Existing test endorses fake JWTs.
- **Impact:** Known-email account impersonation. Fixing general token issuance alone would preserve this login bypass.
- **Verification:** Actual extracted service returned the fixture account with credential=None and its email. In-memory DB only; no real user touched.
- **Recommendation:** Require verified ID tokens or server-side code exchange, validate claims and email status, bind identity to provider subject and remove email-only login. Coordinate the web flow. [Google guidance](https://developers.google.com/identity/sign-in/web/backend-auth).
- **Estimated effort:** 2–4 days.
- **Regression risk:** High: web currently submits Google profile claims rather than a verified ID token.

<a id="aud-003"></a>

## AUD-003: SQLite rolls back failed OTP attempt accounting

- **Category / severity / confidence:** Authentication/reliability · P1 High · Confirmed.
- **Location:** backend/app/services/user_service.py:verify_login_otp (553), reset_password_with_otp (729); backend/app/db/database.py:get_db_connection.
- **Evidence and cause:** Attempt/used updates are followed by HTTPException inside a transaction; SQLite context rolls them back.
- **Impact:** Configured three-attempt limit does not hold. Turso behaves differently because its transactions are missing (AUD-010).
- **Verification:** Four wrong login codes left attempts=0,is_used=0 using actual extracted functions/schema in SQLite :memory:. Reset has the same static pattern but was not separately executed.
- **Recommendation:** Commit atomic attempt/consume accounting before returning errors, add purpose-aware tests and account/origin throttles.
- **Estimated effort:** 1–2 days.
- **Regression risk:** Medium: validate concurrent consume and both database modes.

<a id="aud-004"></a>

## AUD-004: SPA fallback permits paths outside its static root

- **Category / severity / confidence:** Filesystem security · P1 High · Confirmed.
- **Location:** backend/app/main.py:serve_frontend (60).
- **Evidence and cause:** frontend_dist / full_path is checked with is_file and passed to FileResponse without resolved containment. Route is enabled when a web build exists.
- **Impact:** Decoded parent segments can select files outside the build directory, subject to OS/proxy normalization and process permissions.
- **Verification:** Pure path evaluation proved ../../backend/requirements.txt escapes the root. HTTP exploitation was not tested; no sensitive file read.
- **Recommendation:** Use contained static delivery or resolve/reject paths outside frontend_dist before file responses; restrict SPA fallback routes.
- **Estimated effort:** 0.5–1 day.
- **Regression risk:** Low–medium: test encoded paths, Windows separators, SPA links and API 404s.

<a id="aud-005"></a>

## AUD-005: Upload paths use untrusted IDs and filenames

- **Category / severity / confidence:** Filesystem security · P1 High · Confirmed.
- **Location:** backend/app/api/v1/endpoints/document.py:upload_document (48,59); backend/app/services/storage_service.py:upload_file.
- **Evidence and cause:** Temporary paths and object/local storage keys interpolate session_id/filename. Extension checking and lstrip('/') do not reject parent segments; local storage creates parent directories.
- **Impact:** Out-of-root writes and temporary cleanup deletion within process permissions; exploit reach depends on path layout and allowed suffix.
- **Verification:** Static input → open(wb)/storage key → local write/finally remove trace. No exploit write performed.
- **Recommendation:** Use server-generated opaque object/document IDs, safe display basenames and resolved-root containment.
- **Estimated effort:** 1–2 days.
- **Regression risk:** Medium: preserve legacy keys and cover POSIX/Windows path cases.

<a id="aud-006"></a>

## AUD-006: Media attachments permit arbitrary HTTP fetches and local reads

- **Category / severity / confidence:** SSRF/data handling · P1 High · Confirmed.
- **Location:** backend/app/schemas/chat.py:MediaAttachment; backend/app/services/llm_service.py:stream_multimodal_answer; backend/app/services/storage_service.py:download_file (144).
- **Evidence and cause:** Caller url/mime_type reach get_media_bytes. download_file accepts any HTTP(S) target and tries Path(clean_path) without containment. Bytes are attached to model requests.
- **Impact:** Internal network access/local file disclosure to the provider is possible; user-visible exfiltration depends on accepted content and provider behavior.
- **Verification:** Source-to-sink trace only; no internal URL, sensitive file or model request accessed.
- **Recommendation:** Accept owned asset IDs, resolve trusted keys server-side, constrain disk roots and approved remote origins, and enforce response/MIME/size limits.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: preserve authorized CDN/reference flows; depends on AUD-001.

<a id="aud-007"></a>

## AUD-007: Temporary/guest deletion is incomplete across stores

- **Category / severity / confidence:** Privacy/retention · P1 High · Confirmed.
- **Location:** backend/app/services/chat_history_service.py:create_session/save_message/delete_session/purge_expired_temporary_sessions; backend/app/services/orchestrator.py:route_and_stream; backend/app/main.py:_periodic_temporary_cleanup.
- **Evidence and cause:** Temporary registered messages are stored with expiry and hidden from lists. Purge removes vectors and SQL, not raw/media objects or cache. Normal session deletion removes SQL only. Guest uploads can retain vectors/files/media rows. Self-healing creates missing registered sessions as permanent because ChatRequest has no temporary flag.
- **Impact:** Content can outlive visible deletion/three-day promises. Failed temporary creation may become permanent storage. Six-hour cleanup while running is not exact expiry.
- **Verification:** Temporary persistence reproduced in memory; purge/healing/delete/upload traced without running cleanup or inspecting user data.
- **Recommendation:** Define one retention contract across SQL/vectors/files/cache/provider handling; preserve temporary intent and make cleanup durable, retryable and idempotent. Plan historical orphan remediation separately.
- **Estimated effort:** 4–7 days.
- **Regression risk:** High: deletion is irreversible; test only disposable fixtures before approved cleanup.

<a id="aud-008"></a>

## AUD-008: Cleared messages return through the process cache

- **Category / severity / confidence:** Privacy/state consistency · P1 High · Confirmed.
- **Location:** backend/app/services/chat_history_service.py:clear_session_messages (213); backend/app/repositories/session_store.py:get_history_messages (70).
- **Evidence and cause:** SQL clear does not clear cache. An empty SQL message result triggers fallback to session.messages.
- **Impact:** Previously cleared text can be sent to the model on a later turn; deleted session cache also survives.
- **Verification:** Actual extracted repository returned a fixture message after SQL history was cleared.
- **Recommendation:** Evict/reset cache for clear/delete and distinguish empty persistent history from guest history; use an authoritative state model.
- **Estimated effort:** 1–2 days.
- **Regression risk:** Medium: retain intentional guest memory without reviving cleared registered history.

<a id="aud-009"></a>

## AUD-009: Repeated create destroys existing session children

- **Category / severity / confidence:** Data integrity · P1 High · Confirmed.
- **Location:** backend/app/services/chat_history_service.py:create_session (41); backend/app/db/database.py:init_db.
- **Evidence and cause:** INSERT OR REPLACE deletes/reinserts a caller-selected session ID. Child messages/documents/media cascade on deletion.
- **Impact:** Retries can erase history/metadata and reset expiry/pin state, leaving external storage orphaned.
- **Verification:** Actual functions/schema in memory: recreate reduced message count from one to zero. [SQLite REPLACE semantics](https://www.sqlite.org/conflict.html).
- **Recommendation:** Make create idempotent with insert-once/conflict handling and validated ownership; separate updates.
- **Estimated effort:** 1–2 days.
- **Regression risk:** Medium: test concurrent retries and ownership mismatch.

<a id="aud-010"></a>

## AUD-010: Turso adapter has no transaction semantics

- **Category / severity / confidence:** Database reliability · P1 High · Confirmed.
- **Location:** backend/app/db/database.py:TursoCursor.execute, TursoConnection.commit/rollback, get_db_connection.
- **Evidence and cause:** Each execute calls the client independently; commit/rollback are pass and no real transaction is started.
- **Impact:** Multi-statement OTP/password/schema operations can partially commit; local/cloud consistency differs.
- **Verification:** Adapter source traced; no cloud fault-injection or FK verification performed.
- **Recommendation:** Use real client transactions/batches and explicit repository atomicity; exercise failure cases in isolated local/cloud fixtures.
- **Estimated effort:** 2–4 days.
- **Regression risk:** High: all multistatement services and schema startup depend on this wrapper.

<a id="aud-011"></a>

## AUD-011: Docker context can copy secrets/runtime media

- **Category / severity / confidence:** Deployment security · P1 High · Confirmed.
- **Location:** Dockerfile:COPY backend/ ./backend/; .dockerignore.
- **Evidence and cause:** Ignore pattern .env is root-relative; no recursive **/.env exclusion exists. backend/.env exists as an ignored local path. Only selected DB/chroma/upload paths are excluded; other stored media can be copied.
- **Impact:** A build from this workspace may embed secrets/user content. No published image was inspected; actual disclosure is unknown.
- **Verification:** Read Dockerfile, ignore rules and path names only. [Docker context rules](https://docs.docker.com/build/concepts/context/).
- **Recommendation:** Use allowlisted runtime COPY and recursive secret/data exclusions; inspect a disposable context and separately review prior artifacts if warranted.
- **Estimated effort:** 0.5–1 day.
- **Regression risk:** Low: preserve required source/templates and verify startup without local user data.

<a id="aud-012"></a>

## AUD-012: Installed pypdf falls in resource-exhaustion advisory ranges

- **Category / severity / confidence:** Dependencies/availability · P1 High · Confirmed.
- **Location:** backend/requirements.txt:pypdf>=4.1.0; backend/app/services/rag_service.py:extract_text_from_file.
- **Evidence and cause:** Installed 6.17.0 is below the 6.18.1 fixes for GHSA-jw7q-gvrg-4vj3, GHSA-g9cg-prrw-2r8q and GHSA-fp3h-c4fm-7vvf. Untrusted PDFs are parsed synchronously without resource limits.
- **Impact:** Applicable local version exposure; crafted PDFs can consume excessive CPU/memory. Deployment version/exploitation unknown. Application priority reflects unauthenticated in-process parsing.
- **Verification:** Metadata and maintainer advisories checked 2026-10-12; no hostile PDF executed. [FlateDecode](https://github.com/py-pdf/pypdf/security/advisories/GHSA-jw7q-gvrg-4vj3), [font data](https://github.com/py-pdf/pypdf/security/advisories/GHSA-g9cg-prrw-2r8q), [ToUnicode](https://github.com/py-pdf/pypdf/security/advisories/GHSA-fp3h-c4fm-7vvf).
- **Recommendation:** Select a supported patched version after complete advisory review, lock it and bound/isolate parsing. 6.18.1 fixes these three, not necessarily all vulnerabilities.
- **Estimated effort:** 1–2 days plus validation.
- **Regression risk:** Medium: extraction/chunk changes can affect citations and reindexing.

<a id="aud-013"></a>

## AUD-013: Synchronous work blocks asynchronous request execution

- **Category / severity / confidence:** Performance/availability · P1 High · Confirmed.
- **Location:** backend/app/api/v1/endpoints/document.py:upload_document; backend/app/services/{orchestrator,web_search_service,llm_service}.py.
- **Evidence and cause:** Async routes/generators call sync SQL, PDF extraction, embeddings, requests search and sync model stream iteration. Sleeping between yielded tokens does not unblock a pending sync call.
- **Impact:** Slow work can stall unrelated requests in a worker; Docker starts one Uvicorn process. Throughput impact is unmeasured.
- **Verification:** Call-chain review only, no load test. Email/image to_thread usage provides an existing pattern worth preserving.
- **Recommendation:** Use async providers or bounded thread offloading; limit concurrency and isolate CPU parsing when measurements justify it.
- **Estimated effort:** 3–6 days.
- **Regression risk:** Medium: test cancellation, thread safety, DB connection ownership and timeouts.

<a id="aud-014"></a>

## AUD-014: Dimension mismatch recovery deletes the shared vector collection

- **Category / severity / confidence:** Data integrity · P1 High · Confirmed.
- **Location:** backend/app/repositories/vector_store.py:add_chunks (49,84).
- **Evidence and cause:** A matched dimension error deletes/recreates document_knowledge_base and then inserts only current chunks.
- **Impact:** Previously indexed documents can disappear while SQL metadata remains.
- **Verification:** Static exception-path review; no vector store mutation. Activation depends on exception string matching in the deployed Chroma version.
- **Recommendation:** Reject incompatible writes, version embedding collections and explicitly rebuild with validation/rollback.
- **Estimated effort:** 1–3 days.
- **Regression risk:** Medium: preserve old model/dimension access during controlled reindexing.

<a id="aud-015"></a>

## AUD-015: Hash embedding fallback mixes unrelated vector spaces

- **Category / severity / confidence:** Retrieval correctness · P2 Medium · Confirmed.
- **Location:** backend/app/services/embedding_service.py:embed_batch/_local_deterministic_embedding; backend/app/services/rag_service.py:retrieve_context_for_query.
- **Evidence and cause:** Provider failures yield hash vectors in the same dimension/index without provenance. Retrieval also returns top two when every score misses the threshold.
- **Impact:** Successful-looking indexing can produce unreliable or weakly grounded answers after transient failures.
- **Verification:** Algorithm/failure paths reviewed; quality benchmark not performed.
- **Recommendation:** Queue/fail semantic indexing on provider failure or use explicitly separate offline indexes; record model/space and honor low-confidence retrieval.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: identify/reindex affected data without deleting shared collections.

<a id="aud-016"></a>

## AUD-016: Mobile SSE drops events split across progress callbacks

- **Category / severity / confidence:** Client/API correctness · P1 High · Confirmed.
- **Location:** mobile/src/services/api.ts:streamChat/processChunks (718).
- **Evidence and cause:** lastIndex consumes all responseText before complete JSON lines are available; partial JSON is discarded and the continuation lacks the data: prefix.
- **Impact:** Tokens/citations/media can vanish while completion still succeeds.
- **Verification:** Actual api.ts transpiled in memory with mocked XHR: one token frame split into two callbacks produced zero tokens and one completion.
- **Recommendation:** Buffer incomplete lines/frames and parse complete SSE events; test every split offset, batched events, EOF, abort and errors.
- **Estimated effort:** 0.5–1.5 days.
- **Regression risk:** Low–medium: preserve terminal-event and Unicode behavior.

<a id="aud-017"></a>

## AUD-017: In-flight client work is not scoped to conversation transitions

- **Category / severity / confidence:** Client concurrency · P2 Medium · Likely.
- **Location:** frontend/src/App.tsx:selectSession/handleNewSession/handleSendMessage; mobile/App.tsx:selectSession/handleNewChat/handleSendMessage.
- **Evidence and cause:** History responses and stream callbacks mutate global messages without active-request identity checks. Transition/logout paths do not consistently cancel streams. Web new/select paths retain some attached media state.
- **Impact:** Late results may appear in another chat; an attachment may be sent to an unintended conversation.
- **Verification:** Static transitions/callback analysis, revisited after resume. Device/browser race untested; delayed A→B fixture test is the reproduction plan.
- **Recommendation:** Scope results to session/request generations, invalidate/cancel transitions and specify draft/media reset behavior.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: explicitly represent background streams if they are a desired product behavior.

<a id="aud-018"></a>

## AUD-018: Library document attachment updates only client state

- **Category / severity / confidence:** Broken workflow · P2 Medium · Confirmed.
- **Location:** frontend/src/App.tsx:handleAttachDocumentFromModal (176); mobile/App.tsx:handleAttachDocumentFromModal (1059); backend/app/schemas/chat.py:ChatRequest.
- **Evidence and cause:** Callbacks add document metadata to UI only; no association API is called and chat requests carry no selected document IDs. Retrieval uses server session.document_ids.
- **Impact:** Cross-session library documents appear attached but are absent from current retrieval. Same-session documents may already work.
- **Verification:** Modal → callback → request schema → retrieval scope traced.
- **Recommendation:** Add an ownership-checked association or explicit request document selection contract; define copy/reference semantics.
- **Estimated effort:** 2–3 days.
- **Regression risk:** Medium: deletion and shared-document lifetime must be decided first.

<a id="aud-019"></a>

## AUD-019: Generated/mobile media omit the owner used by library filters

- **Category / severity / confidence:** Data consistency · P2 Medium · Confirmed.
- **Location:** backend/app/services/orchestrator.py:_execute_image_generation; backend/app/services/media_service.py:list_assets; mobile/App.tsx:handleAttachFile.
- **Evidence and cause:** Generation calls omit supported user_id parameter; mobile upload omits it too. All Chats filtering uses media_assets.user_id directly, not session owner.
- **Impact:** Registered assets can be missing from the user library while present in session scope.
- **Verification:** Producer/query comparison; generation call sites rechecked after resume. No provider call.
- **Recommendation:** Derive owner from authenticated session on the server; validate a session-based backfill separately.
- **Estimated effort:** 1–2 days.
- **Regression risk:** Medium: guest assets must not be assigned arbitrarily; depends on AUD-001.

<a id="aud-020"></a>

## AUD-020: Storage fallback and reference-image resolution disagree

- **Category / severity / confidence:** Integration reliability · P2 Medium · Confirmed.
- **Location:** backend/app/services/storage_service.py:get_public_url/upload_file; backend/app/services/orchestrator.py:_execute_image_generation; backend/app/services/media_service.py:resolve_local_path.
- **Evidence and cause:** Local fallback after R2 failure still uses CDN/R2-preferred URLs. Reference generation requires a local path. Non-avatar R2 URLs without configured public URL are raw unsigned endpoints.
- **Impact:** Uploads can return broken remote URLs; R2-only image references can be ignored in favor of text generation. Endpoint accessibility is configuration-dependent.
- **Verification:** Static branch trace; R2/CDN behavior not contacted.
- **Recommendation:** Return URLs for the backend actually used; resolve authorized references consistently; use signed/authenticated retrieval and explicit fallback status.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: legacy URLs/caches/storage migrations; coordinate AUD-006.

<a id="aud-021"></a>

## AUD-021: Ingestion is non-atomic and uses filename-based object keys

- **Category / severity / confidence:** Data integrity/reliability · P2 Medium · Confirmed.
- **Location:** backend/app/api/v1/endpoints/document.py:upload_document; backend/app/services/rag_service.py:process_and_index_document; backend/app/services/chat_history_service.py:save_document.
- **Evidence and cause:** Raw objects precede parse/vector/metadata operations with no compensation. documents/{session_id}/{filename} and temp names are reused despite distinct document IDs. Metadata-save failures can be swallowed.
- **Impact:** Same-name uploads overwrite earlier raw files; failures leave orphaned objects/vectors or undurable metadata. Multi-worker uploads may collide.
- **Verification:** Static keys and operation ordering; no upload/concurrency execution.
- **Recommendation:** Use unique IDs, staged ingestion status, failure propagation, idempotency and cleanup/retry steps.
- **Estimated effort:** 3–5 days.
- **Regression risk:** Medium: preserve existing links and define duplicate-file expectations.

<a id="aud-022"></a>

## AUD-022: Intent heuristics bypass grounding and over-trigger image generation

- **Category / severity / confidence:** Business logic · P2 Medium · Confirmed.
- **Location:** backend/app/services/orchestrator.py:_is_conversational_query/_is_image_gen_intent/route_and_stream.
- **Evidence and cause:** 'summarize'/'why' match before explicit DOCUMENT_RAG retrieval; 'Can you create ...' matches image intent regardless of object. AUTO tries documents before live-web intent.
- **Impact:** Document starters can be ungrounded; code requests may generate images; current queries may use stale document context.
- **Verification:** Extracted classifiers returned conversational for 'Summarize key points covered in the document.' and image intent for 'Can you create a Python function?'; route precedence traced.
- **Recommendation:** Honor explicit modes/document references, narrow image commands and add a labeled routing corpus before increasing classifier complexity.
- **Estimated effort:** 1–3 days.
- **Regression risk:** Medium: preserve follow-ups and greetings without unintended provider spend.

<a id="aud-023"></a>

## AUD-023: Search failure is presented as evidence; sources are snippet-only

- **Category / severity / confidence:** Grounding/reliability · P2 Medium · Confirmed.
- **Location:** backend/app/services/web_search_service.py:search; backend/app/services/orchestrator.py:_execute_web_search.
- **Evidence and cause:** Adapters use RSS/search snippets, not full articles. Total failure yields a synthetic Web Search record that becomes a citation.
- **Impact:** Apparent sources may not substantiate answers; complex synthesis lacks depth. data/issues is historical feedback, not a current benchmark.
- **Verification:** Adapters/citation trace; external search integration not executed.
- **Recommendation:** Represent search unavailable explicitly, never cite synthetic fallback content, and evaluate source retrieval/synthesis quality before expanding it.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: bound latency, treat pages as untrusted, preserve source attribution.

<a id="aud-024"></a>

## AUD-024: Histories, uploads and process caches are unbounded

- **Category / severity / confidence:** Performance/scalability · P2 Medium · Confirmed.
- **Location:** backend/app/repositories/session_store.py; backend/app/services/chat_history_service.py:get_session_messages; backend/app/api/v1/endpoints/document.py:upload_document; frontend/src/components/Chat/MessageList.tsx.
- **Evidence and cause:** Cache dictionaries/message lists have no eviction. Every turn loads full SQL history though model formatting uses recent messages. Whole documents are read/batch-embedded. Web renders all messages; mobile uses FlatList.
- **Impact:** Memory and work grow with usage; guest memory differs between workers and is lost on restart.
- **Verification:** Allocation/query/render trace only; capacity not measured.
- **Recommendation:** Bound inputs/context, paginate history, cap/expire caches and measure before adopting shared guest storage or virtualization.
- **Estimated effort:** 3–6 days.
- **Regression risk:** Medium: retention/eviction must preserve user expectations.

<a id="aud-025"></a>

## AUD-025: OTP purposes and delivery outcomes are conflated

- **Category / severity / confidence:** Authentication/reliability · P2 Medium · Confirmed.
- **Location:** backend/app/db/database.py:email_otps; backend/app/services/user_service.py:OTP/reset methods; backend/app/services/email_service.py:_send_smtp_sync.
- **Evidence and cause:** Login/reset share codes without a purpose column. Detached delivery can fail after API success. Missing SMTP logs plaintext OTP body and reports success. Resend cooldown exists but no general login/provider-spend rate limiter.
- **Impact:** Interchangeable challenges, misleading delivery status and possible active credentials in logs when configured without SMTP.
- **Verification:** Schema/query/task/log trace; no real email/logs accessed.
- **Recommendation:** Bind hashed codes to purpose/challenge, track delivery failure/retries, require explicit development mail mode, redact credentials and add abuse budgets.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: preserve recovery and avoid account enumeration; coordinate AUD-003/010.

<a id="aud-026"></a>

## AUD-026: Verification scripts are unsafe as a default regression suite

- **Category / severity / confidence:** Testing · P2 Medium · Confirmed.
- **Location:** backend/test_*.py; backend/verify_*.py; backend/reset_db.py; package manifests.
- **Evidence and cause:** Scripts import configured singletons, initialize/write DBs and can call mail/providers. Some assume users/hardcoded paths or print failure without assertions. Google script approves forged identity. No tracked CI/client test suite.
- **Impact:** Routine execution may touch configured services and cannot establish reliable regressions.
- **Verification:** Eight test/verify scripts plus reset statically reviewed, not run. Only documented isolated probes/type checks executed.
- **Recommendation:** Introduce injectable offline fixtures/assertions, explicit integration markers and CI contract tests for auth/ownership/SSE/retention.
- **Estimated effort:** 4–7 days.
- **Regression risk:** Low behavior risk, medium fixture work; preserve useful scenario intent.

<a id="aud-027"></a>

## AUD-027: Build/deployment lacks reproducibility and fail-fast validation

- **Category / severity / confidence:** Dependencies/operations · P2 Medium · Confirmed.
- **Location:** backend/requirements.txt; Dockerfile; backend/app/core/config.py; backend/app/db/database.py:is_turso_configured; backend/app/repositories/vector_store.py:is_pinecone_configured; README.md.
- **Evidence and cause:** Python minimum-only requirements and undeclared direct httpx import rely on resolution/transitives. Docker npm ci falls back to npm install. Missing cloud configuration can select local stores. README Node minimum is stale.
- **Impact:** Fresh deployment behavior may differ or unexpectedly use ephemeral storage; deployment volumes/configuration unknown.
- **Verification:** Manifest/lock/local metadata/config trace; no install/build/deploy. Targeted advisories are not a complete vulnerability audit.
- **Recommendation:** Lock tested dependencies/runtimes, declare direct imports, fail on lock/config errors and validate intended persistence/readiness.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: provider/native compatibility and deliberate rollout of fail-fast behavior.

<a id="aud-028"></a>

## AUD-028: Reply targets use client IDs that change on reload

- **Category / severity / confidence:** API contract · P2 Medium · Confirmed.
- **Location:** frontend/src/App.tsx:handleSendMessage; mobile/App.tsx:handleSendMessage; backend/app/services/chat_history_service.py:save_message; backend/app/services/orchestrator.py:SSE emission.
- **Evidence and cause:** Clients create optimistic timestamp IDs; SQL uses independent UUIDs; streams return no canonical IDs. reply_to stores the client reference.
- **Impact:** Reply snippets survive, but jump-to-original can fail after history reload.
- **Verification:** Both client request/persistence/response paths traced; browser/native interaction not exercised.
- **Recommendation:** Acknowledge canonical IDs and reconcile optimistic messages, or validate immutable client IDs with idempotency.
- **Estimated effort:** 2–3 days.
- **Regression risk:** Medium: tolerate legacy references and prevent duplicate turns on retry.

<a id="aud-029"></a>

## AUD-029: Mobile history/search/server configuration hides failures

- **Category / severity / confidence:** Mobile correctness · P2 Medium · Confirmed.
- **Location:** mobile/src/services/api.ts:getSessionHistory/getUserSessions/resetApiBaseUrl/getSessionDocuments; mobile/src/components/DrawerMenu.tsx; mobile/src/components/ServerConfigModal.tsx:handleTestPing.
- **Evidence and cause:** History failures return empty arrays; drawer searches only loaded pages. Reset caches DEFAULT_HOST instead of re-evaluating env URL. Test checks saved URL rather than input. Unused getSessionDocuments points to a nonexistent route.
- **Impact:** Outages resemble empty history, older chats cannot be found by search, and server test/reset can mislead users. Unused route helper is not an active broken workflow.
- **Verification:** Static helper/caller review; device networking untested.
- **Recommendation:** Separate error/empty state, use backend search pagination, clear override/cache on reset and test entered URL. Validate consumers before removing/correcting unused helper.
- **Estimated effort:** 2–3 days.
- **Regression risk:** Low–medium: cancel/debounce search and preserve environment selection.

<a id="aud-030"></a>

## AUD-030: Streaming retries and terminal events can hide partial failure

- **Category / severity / confidence:** Reliability/protocol · P2 Medium · Likely.
- **Location:** backend/app/services/llm_service.py:stream_*; backend/app/services/orchestrator.py:_execute_*; frontend/src/App.tsx:onError/onDone callbacks.
- **Evidence and cause:** Fallback can begin after tokens were already emitted, without reset semantics. Error may be followed by done; web terminal callbacks can replace visible error with accumulated answer. Cancellation has no durable partial-turn contract.
- **Impact:** Duplicated partial answers or obscured errors; UI and SQL can disagree about stopped turns.
- **Verification:** Static failure ordering; provider failure after N tokens needs an isolated injected test.
- **Recommendation:** Define one terminal result; retry before visible output or explicitly replace/reset; specify persistence of partial/cancelled turns.
- **Estimated effort:** 2–4 days.
- **Regression risk:** Medium: coordinate both clients and backend persistence.

<a id="aud-031"></a>

## AUD-031: Active image formats are served on the application origin

- **Category / severity / confidence:** Content security · P1 High · Likely.
- **Location:** backend/app/services/media_service.py:ALLOWED_IMAGE_EXTENSIONS/save_uploaded_media; backend/app/api/v1/endpoints/media.py:upload_media; backend/app/main.py:static mounts.
- **Evidence and cause:** SVG is allowed by extension without sanitization/raster decoding; clients offer open/download links. Local files use same-origin static routes; R2 MIME comes from the request.
- **Impact:** Top-level SVG viewing may execute active content against browser state. img rendering alone is not equivalent; CDN origins/browser policies affect impact.
- **Verification:** Format/storage/link trace only; no malicious payload or browser test.
- **Recommendation:** Disallow active types unless required, otherwise sanitize and isolate origin/content policies; verify supported images by decoding.
- **Estimated effort:** 1–2 days.
- **Regression risk:** Medium: establish whether SVG is an intended capability.

<a id="aud-032"></a>

## AUD-032: README and comments overstate verified behavior

- **Category / severity / confidence:** Documentation · P3 Low · Confirmed.
- **Location:** README.md; backend/app/services/{orchestrator,embedding_service,llm_service}.py docstrings; mobile/src/components/ChatInput.tsx.
- **Evidence and cause:** Zero-storage/security/rate-limit/DOCX/camera/rich-rendering claims exceed observed code. Mobile picker includes unsupported DOCX. Comments disagree with configured model names. No prior agent guidance existed.
- **Impact:** Misleading onboarding/product expectations. These new documents correct facts while preserving README.
- **Verification:** Compared active parser, schemas, dependencies, UI and routes; configured provider availability remains unknown.
- **Recommendation:** Reconcile public claims with demonstrated behavior and agreed requirements; align picker or intentionally add support; maintain a verified command/architecture reference.
- **Estimated effort:** 1–2 days.
- **Regression risk:** Low: preserve useful instructions and avoid unverified provider privacy claims.

<a id="aud-033"></a>

## AUD-033: Large orchestration components and duplicate contracts increase change risk

- **Category / severity / confidence:** Maintainability · P3 Low · Confirmed.
- **Location:** frontend/src/App.tsx; frontend/src/components/Modals/UserModal.tsx; frontend/src/services/api.ts; mobile/App.tsx; mobile/src/services/api.ts; backend/app/services/orchestrator.py.
- **Evidence and cause:** Auth/session/upload/stream state is concentrated in large components; web/native types, validation and transport rules are handwritten separately. Backend globals cross service/repository layers.
- **Impact:** Observed contract drift makes fixes fragile. No evidence warrants a framework replacement; no direct static import cycle was established.
- **Verification:** Module/consumer review and passing TS checks, not a complexity/production change-rate study.
- **Recommendation:** After behavior tests, incrementally extract session/stream state and validate/generate API contracts; retain platform-specific UI.
- **Estimated effort:** 3–6 days incrementally.
- **Regression risk:** Medium: avoid coupling web React 18 and native React 19 runtimes.

## Additional uncertainties, not confirmed findings

- Pinecone chunk listing uses dimension 768 and top_k=1000; alternate index dimensions and complete enumeration for larger documents need a contract check.
- Guest caches are process-local; required restart/cross-device continuity and intended worker count are unknown.
- OTP concurrent consume and cloud FK behavior need isolated transaction tests.
- Full dependency advisories, licenses, container OS packages, production storage permissions/backups, provider availability and operational metrics were not exhaustively checked.
- Duplicate session creation from concurrent web uploads/sends is plausible; a browser reproduction is still needed. AUD-009 independently confirms destructive duplicate-create semantics.
- Unescaped display names in HTML email templates warrant safe template-escaping review; no email client impact was tested.
- No SQL injection was established in the reviewed parameterized queries. No arbitrary HTML renderer was found in chat message text; that does not eliminate the separate uploaded-SVG risk.

