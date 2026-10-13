# Verified business workflows

These are source-derived workflows, not assumed requirements or production traces. Related issue IDs link to [technical findings](audit/technical-findings.md). Runtime checks and limits are in [verification](audit/verification.md).

## WF-01: Profile registration, login and recovery

1. Browser UserModal or native AuthModal gathers credentials. Backend user schemas normalize username/email and validate password shape; user_service checks uniqueness/strength and writes users.
2. Passwords are PBKDF2-HMAC-SHA256 with per-user salt and 100,000 iterations; comparison uses secrets.compare_digest. This is a verified implementation detail, not a current-strength certification.
3. Password login returns UserResponse. OTP send selects a registered identity, invalidates/stores a code and dispatches mail; verify checks expiry/attempts/code. Reset uses the same OTP table, then updates the password.
4. Google auth accepts a decoded credential or plain email/profile claims; this is unsafe (AUD-002).
5. Clients cache the returned profile in localStorage/AsyncStorage, load history and render logged-in controls. Logout clears client state; there is no server token revocation because no session-token boundary exists (AUD-001).
6. Profile/avatar/password changes use user ID in requests. Old-password checking exists for password change; other ownership enforcement is absent.

Rules: username/email uniqueness; password length 8–128 and character/personal-info checks; OTP default expiry 180 seconds, cooldown 30 seconds, max attempts 3. Attempt updates roll back locally (AUD-003), login/reset challenges lack purpose and delivery can be misleading (AUD-025). Web offers password-reset flow; native parity is incomplete. No verified email-ownership step for ordinary registration was established.

## WF-02: Conversation lifecycle and history

Clients create or select sessions through /session/create, /session/list and /{id}/history. Registered sessions reference a user; guest IDs can have no SQL row. A client-specified session ID is accepted. create_session uses REPLACE, so repeats can delete children (AUD-009).

History includes messages and document metadata. Lists exclude temporary sessions, optionally search title, sort pinned first then creation order, and paginate when requested. “last_created” means creation ordering, not recent activity ordering. Titles can be renamed; new default titles are derived from the first prompt, shortened beyond 35 characters. Pin and mode update independently.

Web uses URL/history state plus a stored active session; native uses component state. Slow history requests/streams can outlive a switch (AUD-017). Native search sees only already-loaded sessions (AUD-029).

Clear history deletes SQL messages but leaves cached messages, which can reappear in model context (AUD-008). Normal session deletion cascades SQL children but not external files/vectors (AUD-007). Individual asset deletion is a distinct path that attempts physical/vector cleanup.

## WF-03: Submit a prompt and stream the answer

1. App validates nonempty text or media, ensures a session and inserts optimistic user/streaming UI state.
2. API client posts session_id, user_id, message/query, mode, attachments and optional reply_to.
3. ChatRequest normalizes mode aliases and missing session IDs; unknown modes default to AUTO. It has no temporary flag or selected document-ID list.
4. Orchestrator self-heals a missing registered session as permanent, loads cached/persistent state, applies mode, reads preexisting history and records the new prompt in SQL (when a session exists) and memory.
5. It derives an initial title when needed, chooses a strategy, yields citations/media/tokens, then persists a completed assistant response and sends done. Error/cancel behavior varies by strategy (AUD-030).
6. Clients accumulate tokens and finalize optimistic messages. They do not receive SQL canonical message IDs, causing reply-reference drift (AUD-028). Mobile loses partial JSON events (AUD-016).

Reply content is a client-supplied snippet inserted into model context, not a server-validated lookup of the referenced message. The model sees only the last ten nonempty formatted history messages, despite full history being loaded. No durable stream-resume or idempotent turn contract exists.

### Routing precedence

| Requested mode | Verified behavior |
| --- | --- |
| IMAGE_GENERATION | Conversational heuristic can divert to text unless image intent detected; otherwise image strategy |
| MULTIMODAL | Current attachments, else recent images, else conversational response or attach prompt |
| DOCUMENT_RAG | Conversational heuristic runs before document retrieval; otherwise RAG without fallback |
| WEB_SEARCH | Search strategy directly |
| AUTO | Image intent → current attachments → recent-image visual/conversational follow-up → conversation → document retrieval → explicit web intent → general conversation |

This precedence is implementation, not necessarily intended product policy. Broad “summarize”/“why” and “can you create” rules cause confirmed misclassification (AUD-022).

## WF-04: Upload, index and question a document

1. Client uploads a file with session_id and optional user_id. Allowed backend suffixes are .pdf/.txt/.md/.csv/.json/.log.
2. Endpoint reads all bytes, writes a temporary filename and attempts raw storage before parsing.
3. RAG service assigns a document UUID; PDF extraction iterates every page, skips blank text and retains page numbers. Text formats decode UTF-8 with invalid bytes ignored. No DOCX/scanned-PDF OCR exists.
4. Recursive splitting uses default 800-character chunks; tiny fragments <=15 characters are omitted. Overlap is only assured in character fallback.
5. Batch embeddings are stored with document ID, filename, page and chunk index. Metadata enters process cache and, for existing persistent sessions, SQL. The session's document_ids is updated.
6. Queries embed text, filter vector retrieval to those IDs, and select up to configured top K with threshold fallback. LLM formats chunks into grounded answers and citations.
7. Empty extraction/invalid format fails. Raw upload can survive parse failure; metadata/vector/object changes are not atomic (AUD-021). Embedding fallback and mismatch reset undermine retrieval (AUD-014/015).

The historical “first pages only” concern in data/issues is not verified: all pages are extracted, but retrieval only presents selected chunks and can misroute. Full-book summary quality needs an evaluation dataset.

Selecting a document from another chat's library only adds UI metadata, so it does not follow step 5 for the new session (AUD-018).

## WF-05: Search-assisted answering

Orchestrator calls search(query): Google News RSS (three results) and Bing snippets (three) are combined; DuckDuckGo is used if both are empty. Titles are deduplicated using a lowercased prefix. Entries carry title, URL and snippet. These become citations and a model context block; full articles are not fetched.

All-source failure becomes a synthetic search entry rather than a clear unavailable state (AUD-023). Source freshness, factual accuracy and provider scraping reliability were not tested. User-uploaded or web text is untrusted context, not an instruction authority.

## WF-06: Upload/analyze/generate/reuse images

Upload validates extension and a 25 MB media limit, creates a UUID filename and writes storage, then attempts media_assets metadata. Session FK is retained only if the SQL session exists; guests can leave session-null records. Caller owner remains optional.

Current attachments or recent image follow-ups route to multimodal; the backend resolves URL/path bytes and passes them with caller MIME to GenAI. This exposes arbitrary fetch/read risks (AUD-006). Image generation tries configured models using offloaded sync calls, saves bytes and yields a media event. Its orchestrator call omits owner attribution (AUD-019). Reference generation depends on a local file; remote-only R2 reference behavior is incomplete (AUD-020).

The unified library UNIONs document and media rows, filters by session or user plus origin/type/search, orders by creation and pages results. “This Chat” and “All Chats” can differ because missing media.user_id is not derived from session owner. Individual deletion attempts storage/vector cleanup but does not make every other deletion path complete.

## WF-07: Guest and temporary retention

Guest chat text uses process memory where no SQL session exists. This does not prevent raw uploads, vectors or media metadata from persisting. Process restart/worker switching loses guest cache, but may leave those resources.

Registered temporary sessions have is_temporary and expires_at, persist text/doc metadata and are excluded from ordinary lists. Cleanup runs at startup and every six hours, selects expired IDs, attempts document-vector deletion and deletes sessions. Raw objects, media files and cache are not comprehensively cleared. Missing-session self-healing cannot preserve temporary intent (AUD-007).

Product decision required: specify retention and deletion scope/timing across all stores and provider handling before asserting privacy guarantees.

## WF-08: Delivery and operations

Root dev scripts start Uvicorn/Vite/Expo; backend startup writes schema and cleanup state. Docker builds web assets then copies backend into a non-root Python image with /data and port 7860. Vercel SPA deployment needs an external backend URL. EAS scripts build native apps or publish preview OTA updates; native dependency changes may require a compatible runtime/new binary.

No deployment, migration, cleanup, provider test, backup restore or production contact occurred in this audit. Missing operational evidence is recorded rather than inferred.

