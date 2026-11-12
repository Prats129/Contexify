# Assistant planning review coverage

Follow-up: Phase 1A implementation was authorized on 2026-11-12. Current changes and verification are tracked in [Phase 1A checkpoint](phase-1a-progress.md) and [implementation details](phase-1a-security.md). The audit evidence and original path inventory below remain tied to their stated historical baseline.

Review date: 2026-11-07 (Asia/Calcutta). Source baseline: `232546702f8195913d007842944b9873b0d58cfd`. Planning and documentation only; no implementation authorized.

## Evidence rules

- **Verified source** means inspected tracked source at this baseline, not proven deployment behavior.
- **Documented constraint** means linked official platform/provider documentation, checked during this review.
- **Proposal** means a design requiring approval and later implementation/testing.
- **Unresolved** means device, commercial, legal, operational, or runtime evidence is still needed.
- Existing `docs/audit/*` and `docs/review-coverage.md` describe an older baseline. Do not treat their open findings as current without rechecking.
- No environment secrets, private logs, user databases, uploaded content, or configured production services are to be read or contacted.

## Review batches

| Batch | Status | Scope and result |
| --- | --- | --- |
| 1. Inventory and baseline | Complete | Clean initial worktree; tracked file inventory and comparison with old audit. 115 files changed since old baseline. Existing documentation is historical. |
| 2. Identity and package foundations | Complete | Read security.py, google_auth.py, both auth transports, main/config, package manifests, Expo/EAS config and requirements.in. Auth and ownership controls now exist; client bearer credentials remain in localStorage/AsyncStorage. Expo native app exists; no tracked Android/iOS native source tree or voice dependencies found. |
| 3. API, persistence, AI and lifecycle | Complete | Router authorization inventory, SQL transaction implementation, lifecycle leases/tombstones, AI call sites and provider flows inspected. Existing prompt logging and general chat persistence must not receive sensitive assistant content. No device execution framework found. |
| 4. Clients, build and tests | Complete | Structural client/schema survey, dependency lock metadata and sensitive integration paths reviewed. Both TypeScript checks, contract check, 9 config tests, 9 selected backend security tests and 178 direct-run Node tests passed. Node child-process runner initially hit EPERM; direct execution worked. One passing client fixture logs a caught title-sync ReferenceError; document as a test limitation. |
| 5. Platform and security research | Complete | Official Android, Apple, W3C/WebKit, Expo, OWASP, provider and India government sources reviewed; citations embedded in design documents. Device feasibility, store approval and deployment compliance remain unverified. |
| 6. Architecture and documentation | Complete | Eight UTF-8 documents; local links/fences checked; all 171 baseline paths reconciled exactly once; 48 unique public source links. Git confirms only the new docs/assistant directory, with no tracked application changes. |

## Checkpoint

Planning was completed at the baseline below, and the user subsequently authorized Phase 1A on 2026-11-12. Resume current implementation from [Phase 1A checkpoint](phase-1a-progress.md). Historical audit checks used only fixture settings/disposable SQL/files and mocked providers; their results are not relabelled as current. Deployment and later execution capabilities remain outside this phase.

## Review method and scope

The baseline contains **171 tracked paths**: backend 60, frontend 44, mobile 36, existing docs 9, root/scripts/tests/data and guidance 22. All paths are classified in the ledger below. The review covers repository architecture, security-sensitive source paths, interfaces, dependency/configuration structure and assistant integration impact. It is a risk-focused static audit with selected isolated execution, not a line-by-line certification of every UI/test/lockfile or a production penetration test.

Depth labels: **F** = focused source review of relevant implementation sections and callers; **S** = structural survey (symbols/imports/configuration/contract/metadata or syntax), with deeper review still needed before changing that file; **H** = historical documentation used for navigation, not accepted as current implementation evidence; **X** = inventoried but content excluded (assets, user-content candidates or environment values). F does not mean every line or runtime branch was verified. Generated/transitive dependencies were not exhaustively audited; node_modules, virtualenvs, ignored native/build output, local data, private logs and real environments are outside source-content scope.

No app data files were opened. `data/issues` and `data/sample_book.txt` are treated as potential user content and excluded even though tracked. Environment examples were inventoried rather than printed; configuration key/default analysis used source. No host or provider was contacted from application configuration. Research used public official documentation only. Searches that returned secondary sources were not used as technical authority.

## Current architecture and reusable controls

| Area | Verified current source / reuse | Limits and assistant impact |
| --- | --- | --- |
| Identity | `core/security.py`: opaque random bearer, SHA-256 token lookup, expiry and credential-version check; principals distinguish guests; API resource ownership helpers | Seven-day default ordinary session is not transaction authorization; no device public-key binding in auth_sessions |
| Google/OTP | Google library verifier validates signed identity/audience; nonce path and persisted subject; OTP hashing, purpose, attempt and transaction logic | Selected regressions pass; no live Google/mail/identity-provider test |
| API | User/session/document/media/chat routers use principal/ownership dependencies; file content uses scoped ticket/owned asset resolution | New assistant endpoints still need independent function/object/device policy and session migration |
| AI | GenAI text/vision/embeddings, Cloudflare Workers AI image generation; route policy separated; bounded model fallback and HTTP timeouts | No registered device tools, function-execution loop, trusted action planner or verifier. Prompt context is not authorization |
| SQL/lifecycle | SQLite and official Turso HTTP-driver adapter with explicit begin/commit/rollback; deletion/upload/resource leases and tombstones | Live Turso semantics were not exercised here. Existing startup migration pattern and cleanup semantics cannot establish exactly-once external effects |
| Files/retrieval | Chroma/Pinecone, local/R2; owned-key reads, bounded PDF worker/image validation; retrieval metadata | No need for assistant vector storage; private commands must not enter these stores |
| Clients | React web and Expo native; authenticated transports, conversation draft isolation, streaming parsing, cancellation, generated API contracts | Large App/components and duplicated client code; extract narrow assistant module rather than expand monoliths |
| Delivery | Docker digest pins, hashed Python requirements, npm lockfiles, explicit file copies, EAS Android/iOS profiles and OTA runtime | No tracked CI, native security module, release policy evidence or physical-device results; OTA privileges need review |
| Tests | Isolated security harness, protocol/configuration/contracts and client/state/keyboard/scroll tests | Older root verify/test scripts remain side-effectful candidates; do not run them as health checks |

Current declared stack: FastAPI 0.141.1 / Pydantic 2.13.5 / Python 3.11 Docker runtime; web React ^19.3.1, Vite ^8.3.5, TypeScript ~6.0.3; native Expo ~58.0.19, React Native 0.88.0, React 19.3.0. These are manifest evidence, not externally verified release availability or deployed versions. Image generation now uses Cloudflare Workers AI; older architecture documents describe a previous Google Imagen path.

## Current findings and integration risks

New IDs describe this assistant planning review and do not renumber old AUD findings. “Blocking” refers to enabling the specified new assistant surface, not an assertion that all existing chat must be disabled.

| ID / priority | Source evidence and observed fact | Impact and required disposition |
| --- | --- | --- |
| ASST-001 / P1 | `frontend/src/services/auth_transport.ts:30` and `mobile/src/services/auth_transport.ts:31` read/write bearer credentials via localStorage/AsyncStorage | XSS/device-storage exposure; secure mobile credential migration and HttpOnly assistant web-session boundary before sensitive use; existing transport host checks are useful but not key binding |
| ASST-002 / P1 | `core/security.py:Principal`, `db/database.py:auth_sessions`, `core/config.py:155` show ordinary account bearer authority, default TTL 604800 seconds and no device binding | Missing device enrollment, narrow scopes, transaction-bound step-up/permit and replay ledger. Required before new privileged executor |
| ASST-003 / P1 | `mobile/src/services/api.ts:33` accepts HTTP; saved URL at lines 64–69 wins over release environment. Dev server UI hiding is separate in `config/env.ts` | Release code should enforce HTTPS and approved origin policy at transport/enrollment, clear stale host authorization; source does not prove actual release cleartext is reachable on every OS |
| ASST-004 / P1 | `orchestrator.py:583` logs interpolated query; `_route_and_stream` persists prompt and uses text for title; `user_service.py` logs usernames | Sensitive commands could leak into logs/chat titles/history. Separate assistant data plane, redact logs and enforce telemetry allowlist before onboarding private content |
| ASST-005 / P1 | SQL/files/client source has no application-level encryption/key-management boundary for assistant data; `config.py:19` defaults CORS to wildcard; no SPA-wide CSP/CSRF middleware found (asset responses have sandbox headers) | Require secure storage/encryption and web hardening. Hosting encryption/headers may exist but are unverified; cookie addition requires explicit CSRF/origin design |
| ASST-006 / P1 | No assistant registry/native executor/task-state/voice permission/scheduler module found in tracked source/manifests | Major new security feature, not a microphone button; implement guarded core first. Generic `ConfirmContext` stores one boolean resolver and cannot bind sensitive transactions |
| ASST-007 / P1 | EAS scripts invoke global or unpinned npx CLI with `shell: true`; update message uses manual quoting; runtime is appVersion; no tracked CI workflow | Review shell argument handling, pin tooling, native runtime compatibility, signing/provenance and publisher access. No exploit or deployed compromise established; no build/update run |
| ASST-008 / P2 | `db/database.py:init_db` performs startup schema checks; no tracked versioned migration history, backup/restore procedure or deployment key policy | Add migration versioning and rollback/restore evidence for action ledger; retain current SQL adapter, no premature replacement |
| ASST-009 / P2 | Shared behavior duplicated across client transports/stores; App and profile/auth components are large; `requirements.in` includes aiofiles/numpy without direct app imports | Use a small pure assistant core/generated contracts. aiofiles is a cleanup candidate; numpy may be a transitive requirement. No dependency removal justified solely by import scan; inventory/license/SCA before change |
| ASST-010 / P2 | Existing docs/AGENTS baseline is 0c7cd717 while current HEAD is 2325467 with 115 changed files | Historical identity/transaction/SSE/dependency statements are stale. Use this ledger/current source; refresh broader docs only as separately scoped work |

Old AUD-001/AUD-002: current source materially addresses missing bearer ownership and forgeable Google identity. Selected current tests verify cross-user denials, logout revocation, direct-email rejection and signed-token validation in fixtures. This does not close all historical findings or establish production correctness. Old claims of no rate limits, unpinned Python dependencies, no transaction rollback and universally broken SSE must likewise not be copied into the new architecture; the current code and tests differ.

## Checks actually executed

All results are for the baseline above; only documentation was modified.

| Check | Result | Interpretation |
| --- | --- | --- |
| `git status --short` before work | Clean | No pre-existing changes to preserve |
| `git ls-files` and baseline comparison | 171 paths; 115 changed versus old audit | Full path coverage; not exhaustive dependency or content certification |
| AST parse every tracked Python file with UTF-8-SIG | 58 passed | Syntax only, no application import |
| `node frontend/node_modules/typescript/bin/tsc --project frontend/tsconfig.json --noEmit --incremental false` | Exit 0 | Web static types |
| `node mobile/node_modules/typescript/bin/tsc --project mobile/tsconfig.json --noEmit --incremental false` | Exit 0 | Native TS types, not a native build |
| `backend/venv/Scripts/python.exe -B scripts/generate_api_contracts.py --check` | Exit 0, API contracts verified | Existing schema/client contract consistency; no generated edits |
| `backend/venv/Scripts/python.exe -B backend/tests/test_configuration.py` | 9 tests passed | Isolated settings, no .env/provider |
| Selected `backend/tests/test_auth_security.py` cases | 9 tests passed | Fixture SQL/files, mocked providers; see exact selection below |
| `node tests/auth_clients.test.cjs` | 145 passed | Mocked clients/state/streams; one caught title-sync ReferenceError logged in fixture, so not a clean browser E2E claim |
| `node tests/chat_history_scroll.test.cjs` | 29 passed | Mocked layout/history behavior |
| `node tests/mobile_keyboard.test.cjs` | 4 passed | Extracted/mock geometry behavior, not physical-device visual proof |
| Initial `node --test --test-reporter=dot ...` | EPERM launching child processes | Runner limitation; direct file execution above succeeded without changing code |
| Documentation validation | Eight required documents; UTF-8, balanced code fences, local Markdown targets and 171 unique ledger paths passed; `git diff --check` clean | External source availability is based on the research above, not a blanket automated link-health guarantee. New documents additionally checked for trailing whitespace |

Exact backend selection: `SecurityTests.test_cross_user_matrix`, `test_logout_revokes_download_and_api_credentials`, `test_direct_email_google_login_is_rejected`, `test_verified_google_subject_is_persistent_and_client_email_is_ignored`, `test_wrong_otp_attempts_commit_and_revoke_for_each_purpose`, `test_otp_is_bound_to_purpose_and_expiry`, `test_concurrent_otp_use_has_one_winner`, `test_rate_ai_limits_share_user_budget_across_tokens_and_document_uploads`, plus `GoogleVerificationTests` (one test). The complete 232-case security file was not run. Its other classes and test names were surveyed, not treated as passing evidence.

No SCA/secret scanner, native build, Docker context build test, browser/device E2E, provider call, live Turso/R2/Pinecone check, load/battery test, store submission or independent security assessment was executed. Installed dependencies were reused; no npm/pip install or audit-upload operation. A dependency survey initially hit Windows default-decoding error and was corrected to UTF-8-SIG; it did not modify files.

## Assumptions and unresolved decisions

Assumptions used only for planning: adults/India/English first; Android-first delivery; two engineers with QA/security support; 1,000-user cost example and usage mix; account-based assistant; same-device operation. These are not verified business requirements. Decision IDs D1–D10 in [implementation plan](implementation-plan.md) require approval.

Unresolved: physical OS minimums and deployed versions; actual provider tiers/regions/retention; hosting encryption/headers/backups; signing/update integrity and store access; device/key hardware backing; speech accuracy/Hindi/Hinglish; battery/hotword performance; vendor licensing/provisioning; legal retention/region/age obligations; user demand and spend ceiling. Each blocks only its dependent capability/release gate. There is sufficient source evidence to recommend the architecture without provisioning services or contacting production.

## File ledger

The following inventory covers original tracked paths only. The eight new assistant documents are the output of this review and are validated separately. Links are repository-relative; line references in findings are baseline anchors and may drift after implementation.

Coverage totals: F = 55, S = 92, H = 9, X = 15. Total = 171.

| Path | Depth | Evidence scope |
| --- | --- | --- |
| [.dockerignore](../../.dockerignore) | F | Relevant security, architecture or integration sections inspected |
| [.gitignore](../../.gitignore) | S | Repository structure/configuration inventory; no runtime claim |
| [.npmrc](../../.npmrc) | S | Repository structure/configuration inventory; no runtime claim |
| [.prettierignore](../../.prettierignore) | S | Repository structure/configuration inventory; no runtime claim |
| [AGENTS.md](../../AGENTS.md) | F | Relevant security, architecture or integration sections inspected |
| [Dockerfile](../../Dockerfile) | F | Relevant security, architecture or integration sections inspected |
| [README.md](../../README.md) | S | Repository structure/configuration inventory; no runtime claim |
| [backend/.env.example](../../backend/.env.example) | X | Content excluded; asset, data candidate or environment template |
| [backend/app/api/v1/endpoints/chat.py](../../backend/app/api/v1/endpoints/chat.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/api/v1/endpoints/document.py](../../backend/app/api/v1/endpoints/document.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/api/v1/endpoints/health.py](../../backend/app/api/v1/endpoints/health.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/api/v1/endpoints/media.py](../../backend/app/api/v1/endpoints/media.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/api/v1/endpoints/session.py](../../backend/app/api/v1/endpoints/session.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/api/v1/endpoints/user.py](../../backend/app/api/v1/endpoints/user.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/core/concurrency.py](../../backend/app/core/concurrency.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/core/config.py](../../backend/app/core/config.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/core/errors.py](../../backend/app/core/errors.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/core/logging.py](../../backend/app/core/logging.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/core/rate_limits.py](../../backend/app/core/rate_limits.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/core/security.py](../../backend/app/core/security.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/db/__init__.py](../../backend/app/db/__init__.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/db/database.py](../../backend/app/db/database.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/db/turso_http.py](../../backend/app/db/turso_http.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/main.py](../../backend/app/main.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/repositories/session_store.py](../../backend/app/repositories/session_store.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/repositories/vector_store.py](../../backend/app/repositories/vector_store.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/schemas/chat.py](../../backend/app/schemas/chat.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/schemas/document.py](../../backend/app/schemas/document.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/schemas/media.py](../../backend/app/schemas/media.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/schemas/session.py](../../backend/app/schemas/session.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/schemas/user.py](../../backend/app/schemas/user.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/services/asset_lifecycle.py](../../backend/app/services/asset_lifecycle.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/chat_history_service.py](../../backend/app/services/chat_history_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/chat_routing.py](../../backend/app/services/chat_routing.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/email_service.py](../../backend/app/services/email_service.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/services/embedding_service.py](../../backend/app/services/embedding_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/google_auth.py](../../backend/app/services/google_auth.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/image_gen_service.py](../../backend/app/services/image_gen_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/image_validation.py](../../backend/app/services/image_validation.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/llm_service.py](../../backend/app/services/llm_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/media_service.py](../../backend/app/services/media_service.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/services/orchestrator.py](../../backend/app/services/orchestrator.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/pdf_service.py](../../backend/app/services/pdf_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/pdf_worker.py](../../backend/app/services/pdf_worker.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/services/rag_service.py](../../backend/app/services/rag_service.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/app/services/session_lifecycle.py](../../backend/app/services/session_lifecycle.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/storage_service.py](../../backend/app/services/storage_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/upload_lifecycle.py](../../backend/app/services/upload_lifecycle.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/user_service.py](../../backend/app/services/user_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/app/services/web_search_service.py](../../backend/app/services/web_search_service.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/requirements.in](../../backend/requirements.in) | F | Relevant security, architecture or integration sections inspected |
| [backend/requirements.txt](../../backend/requirements.txt) | S | Lock structure / reproducibility; no exhaustive SCA |
| [backend/reset_db.py](../../backend/reset_db.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/test_auto_mode_routing.py](../../backend/test_auto_mode_routing.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/test_multimodal_e2e.py](../../backend/test_multimodal_e2e.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/test_storage_cloudflare.py](../../backend/test_storage_cloudflare.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/tests/test_api_contracts.py](../../backend/tests/test_api_contracts.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/tests/test_auth_security.py](../../backend/tests/test_auth_security.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/tests/test_configuration.py](../../backend/tests/test_configuration.py) | F | Relevant security, architecture or integration sections inspected |
| [backend/tests/test_docker_context.py](../../backend/tests/test_docker_context.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/tests/test_turso_http.py](../../backend/tests/test_turso_http.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/tests/turso_http_fixture.py](../../backend/tests/turso_http_fixture.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/verify_google_auth.py](../../backend/verify_google_auth.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/verify_otp_auth.py](../../backend/verify_otp_auth.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/verify_password_reset.py](../../backend/verify_password_reset.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/verify_persistence.py](../../backend/verify_persistence.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [backend/verify_rag.py](../../backend/verify_rag.py) | S | AST / symbols / boundary survey; not run unless listed above |
| [data/issues](../../data/issues) | X | Content excluded; asset, data candidate or environment template |
| [data/sample_book.txt](../../data/sample_book.txt) | X | Content excluded; asset, data candidate or environment template |
| [deploy_mobile.bat](../../deploy_mobile.bat) | S | Repository structure/configuration inventory; no runtime claim |
| [docs/architecture.md](../../docs/architecture.md) | H | Historical baseline; superseded where current source differs |
| [docs/audit/prioritized-roadmap.md](../../docs/audit/prioritized-roadmap.md) | H | Historical baseline; superseded where current source differs |
| [docs/audit/product-recommendations.md](../../docs/audit/product-recommendations.md) | H | Historical baseline; superseded where current source differs |
| [docs/audit/technical-findings.md](../../docs/audit/technical-findings.md) | H | Historical baseline; superseded where current source differs |
| [docs/audit/verification.md](../../docs/audit/verification.md) | H | Historical baseline; superseded where current source differs |
| [docs/business-workflows.md](../../docs/business-workflows.md) | H | Historical baseline; superseded where current source differs |
| [docs/module-map.md](../../docs/module-map.md) | H | Historical baseline; superseded where current source differs |
| [docs/project-overview.md](../../docs/project-overview.md) | H | Historical baseline; superseded where current source differs |
| [docs/review-coverage.md](../../docs/review-coverage.md) | H | Historical baseline; superseded where current source differs |
| [frontend/.env.example](../../frontend/.env.example) | X | Content excluded; asset, data candidate or environment template |
| [frontend/.npmrc](../../frontend/.npmrc) | S | Repository structure/configuration inventory; no runtime claim |
| [frontend/index.html](../../frontend/index.html) | F | Relevant security, architecture or integration sections inspected |
| [frontend/package-lock.json](../../frontend/package-lock.json) | S | Lock structure / reproducibility; no exhaustive SCA |
| [frontend/package.json](../../frontend/package.json) | F | Relevant security, architecture or integration sections inspected |
| [frontend/public/favicon.png](../../frontend/public/favicon.png) | X | Content excluded; asset, data candidate or environment template |
| [frontend/public/logo.png](../../frontend/public/logo.png) | X | Content excluded; asset, data candidate or environment template |
| [frontend/public/manifest.json](../../frontend/public/manifest.json) | F | Relevant security, architecture or integration sections inspected |
| [frontend/public/original_logo.jpg](../../frontend/public/original_logo.jpg) | X | Content excluded; asset, data candidate or environment template |
| [frontend/src/App.tsx](../../frontend/src/App.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/ChatHeader.tsx](../../frontend/src/components/Chat/ChatHeader.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/ChatInput.tsx](../../frontend/src/components/Chat/ChatInput.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/ChatPromptTimeline.tsx](../../frontend/src/components/Chat/ChatPromptTimeline.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/ChatWorkspace.tsx](../../frontend/src/components/Chat/ChatWorkspace.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/CitationsBox.tsx](../../frontend/src/components/Chat/CitationsBox.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/MessageItem.tsx](../../frontend/src/components/Chat/MessageItem.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/MessageList.tsx](../../frontend/src/components/Chat/MessageList.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Chat/SourcesPopover.tsx](../../frontend/src/components/Chat/SourcesPopover.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Modals/AttachmentsModal.tsx](../../frontend/src/components/Modals/AttachmentsModal.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Modals/ConfirmModal.tsx](../../frontend/src/components/Modals/ConfirmModal.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Modals/PasswordStrengthMeter.tsx](../../frontend/src/components/Modals/PasswordStrengthMeter.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Modals/UserModal.tsx](../../frontend/src/components/Modals/UserModal.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Sidebar/DocumentDropzone.tsx](../../frontend/src/components/Sidebar/DocumentDropzone.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Sidebar/ModeSelector.tsx](../../frontend/src/components/Sidebar/ModeSelector.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Sidebar/SessionHistory.tsx](../../frontend/src/components/Sidebar/SessionHistory.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Sidebar/Sidebar.tsx](../../frontend/src/components/Sidebar/Sidebar.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/components/Sidebar/UserProfileCard.tsx](../../frontend/src/components/Sidebar/UserProfileCard.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/context/ConfirmContext.tsx](../../frontend/src/context/ConfirmContext.tsx) | F | Relevant security, architecture or integration sections inspected |
| [frontend/src/context/ThemeContext.tsx](../../frontend/src/context/ThemeContext.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/hooks/useChatSessions.ts](../../frontend/src/hooks/useChatSessions.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/hooks/useConversationState.ts](../../frontend/src/hooks/useConversationState.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/main.tsx](../../frontend/src/main.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/services/api.ts](../../frontend/src/services/api.ts) | F | Relevant security, architecture or integration sections inspected |
| [frontend/src/services/auth_transport.ts](../../frontend/src/services/auth_transport.ts) | F | Relevant security, architecture or integration sections inspected |
| [frontend/src/services/conversation_store.ts](../../frontend/src/services/conversation_store.ts) | F | Relevant security, architecture or integration sections inspected |
| [frontend/src/styles/main.css](../../frontend/src/styles/main.css) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/types/api-contracts.ts](../../frontend/src/types/api-contracts.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/types/index.ts](../../frontend/src/types/index.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/src/vite-env.d.ts](../../frontend/src/vite-env.d.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [frontend/tsconfig.json](../../frontend/tsconfig.json) | S | Repository structure/configuration inventory; no runtime claim |
| [frontend/tsconfig.node.json](../../frontend/tsconfig.node.json) | S | Repository structure/configuration inventory; no runtime claim |
| [frontend/vercel.json](../../frontend/vercel.json) | F | Relevant security, architecture or integration sections inspected |
| [frontend/vite.config.js](../../frontend/vite.config.js) | S | Repository structure/configuration inventory; no runtime claim |
| [frontend/vite.config.ts](../../frontend/vite.config.ts) | S | Repository structure/configuration inventory; no runtime claim |
| [mobile/.env.example](../../mobile/.env.example) | X | Content excluded; asset, data candidate or environment template |
| [mobile/.gitignore](../../mobile/.gitignore) | S | Repository structure/configuration inventory; no runtime claim |
| [mobile/.npmrc](../../mobile/.npmrc) | S | Repository structure/configuration inventory; no runtime claim |
| [mobile/App.tsx](../../mobile/App.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/LICENSE](../../mobile/LICENSE) | S | Repository structure/configuration inventory; no runtime claim |
| [mobile/app.json](../../mobile/app.json) | F | Relevant security, architecture or integration sections inspected |
| [mobile/assets/android-icon-background.png](../../mobile/assets/android-icon-background.png) | X | Content excluded; asset, data candidate or environment template |
| [mobile/assets/android-icon-foreground.png](../../mobile/assets/android-icon-foreground.png) | X | Content excluded; asset, data candidate or environment template |
| [mobile/assets/android-icon-monochrome.png](../../mobile/assets/android-icon-monochrome.png) | X | Content excluded; asset, data candidate or environment template |
| [mobile/assets/favicon.png](../../mobile/assets/favicon.png) | X | Content excluded; asset, data candidate or environment template |
| [mobile/assets/icon.png](../../mobile/assets/icon.png) | X | Content excluded; asset, data candidate or environment template |
| [mobile/assets/logo.png](../../mobile/assets/logo.png) | X | Content excluded; asset, data candidate or environment template |
| [mobile/assets/splash-icon.png](../../mobile/assets/splash-icon.png) | X | Content excluded; asset, data candidate or environment template |
| [mobile/eas.json](../../mobile/eas.json) | F | Relevant security, architecture or integration sections inspected |
| [mobile/index.ts](../../mobile/index.ts) | S | Repository structure/configuration inventory; no runtime claim |
| [mobile/package-lock.json](../../mobile/package-lock.json) | S | Lock structure / reproducibility; no exhaustive SCA |
| [mobile/package.json](../../mobile/package.json) | F | Relevant security, architecture or integration sections inspected |
| [mobile/src/components/AttachmentsModal.tsx](../../mobile/src/components/AttachmentsModal.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/AuthModal.tsx](../../mobile/src/components/AuthModal.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/ChatInput.tsx](../../mobile/src/components/ChatInput.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/CitationsSheet.tsx](../../mobile/src/components/CitationsSheet.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/DrawerMenu.tsx](../../mobile/src/components/DrawerMenu.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/Header.tsx](../../mobile/src/components/Header.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/MessageItem.tsx](../../mobile/src/components/MessageItem.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/PasswordStrengthMeter.tsx](../../mobile/src/components/PasswordStrengthMeter.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/ProfileModal.tsx](../../mobile/src/components/ProfileModal.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/components/ServerConfigModal.tsx](../../mobile/src/components/ServerConfigModal.tsx) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/config/env.ts](../../mobile/src/config/env.ts) | F | Relevant security, architecture or integration sections inspected |
| [mobile/src/hooks/useConversationState.ts](../../mobile/src/hooks/useConversationState.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/services/api.ts](../../mobile/src/services/api.ts) | F | Relevant security, architecture or integration sections inspected |
| [mobile/src/services/auth_transport.ts](../../mobile/src/services/auth_transport.ts) | F | Relevant security, architecture or integration sections inspected |
| [mobile/src/services/conversation_store.ts](../../mobile/src/services/conversation_store.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/theme/colors.ts](../../mobile/src/theme/colors.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/types/api-contracts.ts](../../mobile/src/types/api-contracts.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/src/types/index.ts](../../mobile/src/types/index.ts) | S | Symbols/imports/call sites and type checks; UI not device-tested |
| [mobile/tsconfig.json](../../mobile/tsconfig.json) | S | Repository structure/configuration inventory; no runtime claim |
| [package-lock.json](../../package-lock.json) | S | Lock structure / reproducibility; no exhaustive SCA |
| [package.json](../../package.json) | F | Relevant security, architecture or integration sections inspected |
| [ruff.toml](../../ruff.toml) | S | Repository structure/configuration inventory; no runtime claim |
| [scripts/check_api_contracts.cjs](../../scripts/check_api_contracts.cjs) | S | Repository structure/configuration inventory; no runtime claim |
| [scripts/deploy-mobile.js](../../scripts/deploy-mobile.js) | F | Relevant security, architecture or integration sections inspected |
| [scripts/generate_api_contracts.py](../../scripts/generate_api_contracts.py) | F | Relevant security, architecture or integration sections inspected |
| [scripts/update-mobile.js](../../scripts/update-mobile.js) | F | Relevant security, architecture or integration sections inspected |
| [tests/auth_clients.test.cjs](../../tests/auth_clients.test.cjs) | F | Relevant security, architecture or integration sections inspected |
| [tests/chat_history_scroll.test.cjs](../../tests/chat_history_scroll.test.cjs) | S | Mock test structure and executed results; no device evidence |
| [tests/mobile_keyboard.test.cjs](../../tests/mobile_keyboard.test.cjs) | S | Mock test structure and executed results; no device evidence |
| [ty.toml](../../ty.toml) | S | Repository structure/configuration inventory; no runtime claim |
| [update_mobile.bat](../../update_mobile.bat) | S | Repository structure/configuration inventory; no runtime claim |
