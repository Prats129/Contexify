# Review coverage and continuation ledger

Audit date: 2026-10-12. Baseline: `0c7cd717c262b4fd5afcd1d785815cb53066c85e`.

## Recovery checkpoint

The prior conversation and compacted review notes survived the usage-limit interruption. Temporary tool stores containing drafts/probe scripts did **not** survive. The recovered repository check confirms the same commit, a clean working tree, 121 tracked files, and no existing AGENTS.md, CLAUDE.md or docs review artifacts. The previous drafts were not persisted. This ledger is the first saved artifact after resumption.

“Previously verified” below means evidence exists in retained conversation/tool output. It does not mean the check was rerun after resumption. No application edits, dependency installations, migrations, production access or existing integration scripts were performed.

## Status definitions

- **Reviewed:** substantive static contents and role/consumers examined. This is not runtime, visual, security or exhaustive branch coverage.
- **Partially Reviewed:** substantive review exists, but the row explicitly identifies omitted material or verification.
- **Not Reviewed:** no reliable evidence of substantive review. There are currently no original tracked files wholly in this state; remaining verification tasks are listed separately.
- **Excluded:** deliberately outside detailed review, with reason.

Inventory reconciliation at recovery: **121 files**; 77 Reviewed, 34 Partially Reviewed, 10 Excluded, 0 Not Reviewed. These counts do not establish 100% understanding.

## Previously completed batches and evidence

| Batch | Confirmed previous work | Limits / continuation |
| --- | --- | --- |
| Discovery | All tracked paths, entry points, manifests, scripts, Docker/Vercel/EAS, README; no prior agent instructions | Reconcile ledger against git inventory after documentation creation |
| Backend | All routers, schemas, DB/SQL adapters, repositories, services and tests traced; architecture/workflows identified | No actual app import/startup or configured DB/provider access |
| Web | App, API, hooks, contexts, types and component behavior/JSX reviewed | Style details and browser interaction/accessibility not fully reviewed |
| Mobile | App behavior, API and all component behavior/JSX reviewed | Native/device/OAuth/network integrations untested; style detail partial |
| Static checks | Both client no-emit TypeScript checks passed; all 38 backend Python files parsed | Prior outputs retained; no production build/native build/runtime guarantee |
| Behavioral probes | Isolated actual-function extraction + SQLite :memory: confirmed Google email impersonation, OTP rollback, temporary SQL storage, destructive repeated session create, cleared-history cache fallback, routing misclassification | Dependency stubs, no full HTTP integration; scripts must be reconstructed from retained content |
| Mobile stream | Actual api.ts transpiled in memory with mocked XHR lost a split token event while reporting completion | No device/provider/network call |
| Dependency evidence | Installed metadata read; pypdf 6.17.0 matched three maintainer advisories affecting <6.18.1; Vite advisory applicability checked | Full dependency/SBOM/OS-image analysis incomplete; deployment versions unknown |
| Documentation | Architecture, overview, AGENTS and 33 finding records were drafted in temporary state | Drafts were not saved; reconstruct carefully and validate before marking complete |

## Recovery work checklist

1. Completed: persisted this ledger before resuming substantive documentation.
2. Completed within static scope: revisited uncertain template/logic paths; remaining visual/native/integration gaps stay explicitly partial below.
3. Completed: persisted 33 findings with confidence, source/function references and verification limits.
4. Completed: architecture, overview, module map, workflows, recommendations, roadmap and AGENTS guidance; README preserved.
5. Completed: reconstructed and saved isolated probes; reran them because their temporary originals were lost, verifying the reconstructed artifacts.
6. Completed: all 121 original paths reconcile, local links resolve, all finding IDs resolve and tracked application/config files are unchanged.

## Unresolved questions and unperformed verification

- Who is authorized to use the deployed API, and is an external gateway imposing any access restrictions? No hosting account or production URL was inspected.
- Which SQL/vector/object-storage modes, versions, backups and volumes are deployed? Cloud transaction/FK behavior is untested.
- What is the agreed retention contract for guest/temporary chats, uploaded objects, vector data, logs and model providers? Source/UI/README differ.
- What are required upload sizes, concurrency, latency objectives and expected session history sizes? No benchmarks or query plans were run.
- Which model IDs/quotas and Google OAuth client/audience configurations are valid? No provider credentials or entitlements checked.
- Browser path normalization, SVG document execution, delayed UI races and native platform behavior need isolated integration tests.
- Full package vulnerability/license review, image/deployment inspection, restoration testing, accessibility and visual QA remain outside completed checks.
- Feature usage/removal decisions need business confirmation; limited code references do not establish lack of external consumers.
- Actual .env values, user databases, logs, uploaded documents and media were excluded for privacy and to avoid production interaction.

## File ledger

All rows below refer to the original inventory. New audit documents will be listed separately after creation.

| File | Status | Evidence / remaining scope |
| --- | --- | --- |
| `.dockerignore` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `.gitignore` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `Dockerfile` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `README.md` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/.env.example` | Partially Reviewed | Key names and default presence reviewed; credentials/environment values not printed. |
| `backend/app/api/v1/endpoints/chat.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/api/v1/endpoints/document.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/api/v1/endpoints/health.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/api/v1/endpoints/media.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/api/v1/endpoints/session.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/api/v1/endpoints/user.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/core/config.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/core/logging.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/db/__init__.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/db/database.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/main.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/repositories/session_store.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/repositories/vector_store.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/schemas/chat.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/schemas/document.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/schemas/media.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/schemas/session.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/schemas/user.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/chat_history_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/email_service.py` | Partially Reviewed | Delivery/OTP logic reviewed; HTML template styling not comprehensively assessed. |
| `backend/app/services/embedding_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/image_gen_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/llm_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/media_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/orchestrator.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/rag_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/storage_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/user_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/app/services/web_search_service.py` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/requirements.txt` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `backend/reset_db.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/test_auto_mode_routing.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/test_multimodal_e2e.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/test_storage_cloudflare.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/verify_google_auth.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/verify_otp_auth.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/verify_password_reset.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/verify_persistence.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `backend/verify_rag.py` | Reviewed | Static review only. Not run: configured DB/provider/email side effects or destructive reset. |
| `data/issues` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `data/sample_book.txt` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `deploy_mobile.bat` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/.env.example` | Partially Reviewed | Key names and default presence reviewed; credentials/environment values not printed. |
| `frontend/index.html` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/package-lock.json` | Partially Reviewed | Manifest/root resolutions and engines checked; transitive source/license/advisory audit incomplete. |
| `frontend/package.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/public/favicon.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `frontend/public/logo.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `frontend/public/manifest.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/public/original_logo.jpg` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `frontend/src/App.tsx` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/components/Chat/ChatHeader.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Chat/ChatInput.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Chat/ChatPromptTimeline.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Chat/ChatWorkspace.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Chat/CitationsBox.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Chat/MessageItem.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Chat/MessageList.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Chat/SourcesPopover.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Modals/AttachmentsModal.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Modals/ConfirmModal.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Modals/UserModal.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Sidebar/DocumentDropzone.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Sidebar/ModeSelector.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Sidebar/SessionHistory.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Sidebar/Sidebar.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/components/Sidebar/UserProfileCard.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `frontend/src/context/ConfirmContext.tsx` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/context/ThemeContext.tsx` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/hooks/useChatSessions.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/main.tsx` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/services/api.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/styles/main.css` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/types/index.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/src/vite-env.d.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/tsconfig.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/tsconfig.node.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/vercel.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/vite.config.js` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `frontend/vite.config.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/.env.example` | Partially Reviewed | Key names and default presence reviewed; credentials/environment values not printed. |
| `mobile/.gitignore` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/App.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/LICENSE` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/app.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/assets/android-icon-background.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `mobile/assets/android-icon-foreground.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `mobile/assets/android-icon-monochrome.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `mobile/assets/favicon.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `mobile/assets/icon.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `mobile/assets/logo.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `mobile/assets/splash-icon.png` | Excluded | Binary artwork; names/sizes inventoried, image contents not reviewed. |
| `mobile/eas.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/index.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/package-lock.json` | Partially Reviewed | Manifest/root resolutions and engines checked; transitive source/license/advisory audit incomplete. |
| `mobile/package.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/src/components/AttachmentsModal.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/AuthModal.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/ChatInput.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/CitationsSheet.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/DrawerMenu.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/Header.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/MessageItem.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/PasswordStrengthMeter.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/ProfileModal.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/components/ServerConfigModal.tsx` | Partially Reviewed | Behavior and JSX reviewed, often via AST with style/className removed; detailed visual styles and device/browser interactions remain unverified. |
| `mobile/src/config/env.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/src/services/api.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/src/theme/colors.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/src/types/index.ts` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `mobile/tsconfig.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `package-lock.json` | Partially Reviewed | Manifest/root resolutions and engines checked; transitive source/license/advisory audit incomplete. |
| `package.json` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `scripts/deploy-mobile.js` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `scripts/update-mobile.js` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |
| `update_mobile.bat` | Reviewed | Prior static review recorded in retained conversation; runtime behavior not implied. |

## Ignored/generated/external exclusions

Installed root/frontend/mobile node_modules and backend/venv were excluded from source review except narrowly reading tool/package metadata. frontend/dist, mobile/dist, mobile/.expo, TypeScript build-info, Python caches and generated outputs were excluded. Local backend/data and test_sessions.db were not opened. Actual .env files were not read. Git internals are not application source. Ten tracked PNG/JPG assets were excluded from content review. Tracked vite.config.js was reviewed alongside vite.config.ts, not silently skipped as generated.

## Post-resumption batch log

- Recovery batch: repository identity and clean status confirmed; prior evidence separated from lost draft state; ledger created.
- Recovery verification batch: ledger read back from disk; previously truncated reset-email template section read; asset deletion, stream transitions and image ownership call sites revisited. No source changes made.
- Findings batch: all 33 original IDs restored and saved to docs/audit/technical-findings.md with evidence, confidence, impact, verification limits, recommendation, effort and regression risk.
- Knowledge batch: AGENTS.md, project-overview.md and architecture.md persisted from retained evidence and source rechecks.
- Module/workflow batch: document ingestion, route order, media metadata, asset deletion, search fallback and native environment-config consumer rechecked; module-map.md and business-workflows.md saved. Individual deletion attempts are distinguished from incomplete session deletion.
- Product/roadmap batch: six evidence-backed capability proposals, four product hypotheses and six simplification candidates saved separately; all 33 findings mapped to implementation stages. No feature removal or implementation performed.
- Verification batch: docs/audit/verification.md saved with reconstructed Python and JavaScript probes; both reran with exit 0 using memory/stubs only. All 38 Python files parsed again. Prior client TypeScript checks are recorded as prior passes, not reruns.
- Final reconciliation: 121 original files = 121 unique ledger rows, no missing/extra entries; 77 Reviewed / 34 Partially Reviewed / 10 Excluded. All 33 finding IDs and local documentation targets resolve. No tracked baseline file changed.

## Completion status and persistent artifacts

The static onboarding/audit is complete within the recorded scope. This does not certify runtime, visual, deployment or exhaustive security coverage. Remaining work is the explicitly listed integration/business/operational verification, not silently omitted modules. No fixes, feature changes, installs, migrations or deployment occurred.

Created: [AGENTS.md](../AGENTS.md), [project overview](project-overview.md), [architecture](architecture.md), [module map](module-map.md), [business workflows](business-workflows.md), this ledger, [technical findings](audit/technical-findings.md), [product recommendations](audit/product-recommendations.md), [roadmap](audit/prioritized-roadmap.md) and [verification](audit/verification.md). All were new files; existing README and source were preserved.

For a future session: read this ledger and the findings first, compare the current commit/diff to the baseline, then choose the approved roadmap scope. Before runtime testing, provide isolated disposable databases/files/provider stubs. Prioritize ownership/authentication tests, file containment, local/cloud transaction parity, retention across stores, stream splits/transitions and document-library association. Validate production exposure/versions/backups and business retention promises only through an authorized process. Detailed visual/accessibility/device review and full dependency/license/container analysis remain separate pending scopes. Implementation requires the user's approval.

