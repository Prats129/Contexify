# Module map

This map covers behavior and relationships; [file-level coverage](review-coverage.md) records partial visual/dependency review. File references are relative to repository root. Tests below are existing scenario scripts, **not** a passing isolated suite (AUD-026).

## Backend

| Module / important files and functions | Responsibility, input → output | Dependencies, state and consumers | Errors / existing test evidence |
| --- | --- | --- | --- |
| app/main.py; core/config.py; core/logging.py | Environment → FastAPI routers/static hosting; startup schema/cleanup; logs | All service singletons, filesystem, settings; entry for Uvicorn | Startup has side effects; cleanup catches/logs failures; no readiness/ops tests |
| api/v1/endpoints/health.py:health_check | Request → liveness-like JSON | No dependency readiness validation | No focused test |
| schemas/{chat,document,media,session,user}.py | JSON/form contracts, aliases, validation → typed data | Used by routers/services; independently mirrored by both client types | Pydantic field/model validation; no standalone schema suite |
| api/v1/endpoints/user.py + services/user_service.py:register_user, authenticate_user, authenticate_with_google | Password/OTP/Google claims → UserResponse; profile/avatar/password mutation | users/email_otps SQL, storage, email; both auth/profile UIs | HTTP errors; OTP rollback and Google trust defects; verify_google_auth, verify_otp_auth, verify_password_reset |
| services/email_service.py:send_otp_email, send_password_reset_otp_email, _send_email_sync | Recipient/challenge → delivery boolean | Brevo HTTPS then SMTP; sync delivery offloaded; generated HTML/text | Provider exceptions logged; no-SMTP returns success and logs body; no isolated transport test |
| db/database.py:TursoCursor, TursoConnection, get_db_connection, init_db; db/__init__.py | SQL/params → rows; schema creation/ALTER | sqlite3 or libsql_client; all persistence services | SQLite rollback, cloud no-op rollback; no versioned migration harness |
| api/v1/endpoints/session.py + services/chat_history_service.py | Create/list/title/pin/mode/history/clear/delete/purge → typed sessions/messages/docs | SQL; list filters temporary; pinned/creation sort; orchestrator and clients | create uses REPLACE; JSON conversion/fallbacks; verify_persistence plus isolated AUD-007/008/009 probes |
| repositories/session_store.py:get_or_create_session/get_history_messages/record_message | Session ID → mutable cached state; cache+SQL metadata/history bridge | ChatHistoryService, DocumentMetadata; orchestrator/RAG/document routes | Process-local dictionaries; empty SQL falls back to cache; isolated AUD-008 probe |
| api/v1/endpoints/document.py + services/rag_service.py:process_and_index_document/retrieve_context_for_query | File/session → metadata/vectors; query/session → selected chunks | PDF/text parser, embedding/vector/session repositories, object storage | Format errors; ingestion errors exposed, temp finally cleanup; verify_rag has a hardcoded old workspace path |
| services/embedding_service.py:embed_batch/_local_deterministic_embedding | Texts → numeric vectors | Google GenAI/settings; RAG consumer | Provider failure becomes hash vectors; no semantic quality fixture |
| repositories/vector_store.py:add_chunks/similarity_search/get_document_chunks/delete_document/clear_all | Vectors+metadata/filter → chunks | Chroma persistent collection or Pinecone; RAG/routes/purge consumers | Empty-result fallbacks; destructive mismatch recovery; no isolated parity tests |
| api/v1/endpoints/chat.py + services/orchestrator.py:route_and_stream/_execute_* | ChatRequest → SSE token/citation/media/error/done | All chat strategies; SQL/cache writes; title/mode update; previous-image follow-up | Strategy errors often emit error then done; test_auto_mode_routing, test_multimodal_e2e; classifier probes |
| services/llm_service.py:stream_rag_answer/stream_web_search_answer/stream_conversational_answer/stream_multimodal_answer | Query/history/context/media → text tokens | Google models; storage-backed media bytes; orchestrator only | Configured model fallbacks, canned/local failure behavior; no deterministic partial-stream test |
| services/web_search_service.py:search and three adapters | Query → deduplicated title/URL/snippet list | Google News RSS, Bing, DuckDuckGo; orchestrator builds citations | Sync timeouts; empty failures become synthetic result; no source-quality benchmark |
| services/image_gen_service.py:generate_image/generate_from_reference | Prompt/reference bytes → MediaAttachment | GenAI/Imagen, thread offload, media_service | Model fallback/errors; test_multimodal_e2e calls providers rather than a stub |
| api/v1/endpoints/media.py + services/media_service.py:save_uploaded_media/save_generated_image/list_assets/delete_asset | Multipart bytes → attachment; filters → unified document/image library | SQL UNION query, storage; session owner fields optional; both attachment modals | 25 MB media limit, extension checking, metadata-write failures may log only; no library ownership fixture |
| services/storage_service.py:upload_file/download_file/delete_file/get_public_url | Bytes/key/URL → storage result or bytes | boto3 R2 or disk, httpx external reads; avatar/media/document consumers | Local fallback and URL mismatch; test_storage_cloudflare is side-effectful |
| reset_db.py, test_*.py, verify_*.py | Manual reset and scenario verification | Configured app/database/providers, not isolated fixtures | All reviewed statically; no execution authorized in audit |

## Browser modules

| Files | Responsibilities and interfaces | Dependencies / error and test behavior |
| --- | --- | --- |
| src/main.tsx, App.tsx | Context mount; auth restore; URL/session state; send/stop; upload; library callbacks; profile/login/logout; history selection | apiService, useChatSessions, contexts; optimistic UI and streaming callbacks; no runtime UI tests |
| src/services/api.ts | fetch JSON/multipart, URL normalization, SSE reader and error extraction | Types/index.ts and backend wire contract; AbortController; does not supply authentication tokens |
| src/hooks/useChatSessions.ts | Debounced query, paging, sort/pin updates and request cancellation | SQL list API; cached sort preference; initial request safeguards worth preserving; late-page/auth transitions still need tests |
| context/ThemeContext.tsx, context/ConfirmContext.tsx | Theme/accent persistence; Promise-based confirmation modal | localStorage and ConfirmModal; browser-only state, no backend auth |
| Chat/ChatWorkspace, ChatHeader, ChatInput | Composer, document/media/reply chips, mode selection, starter prompts, drag/drop, temporary state | App callbacks; unsupported-file behavior depends on backend; no camera/voice implementation found |
| Chat/MessageList, MessageItem, ChatPromptTimeline | Render messages, streaming, selection/reply/copy, scroll/jump/timeline | Types/callbacks, plain React rendering; no arbitrary HTML renderer found; full list rendered |
| Chat/SourcesPopover; Chat/CitationsBox | Citation display/linking; CitationsBox has no tracked consumer found | Document/web citation shape; HTTP(S) link handling; candidate consolidation only |
| Sidebar/Sidebar, SessionHistory, UserProfileCard | History controls, profile and sidebar presentation | Hook/App data, confirmations; session paging/search handled through props |
| Sidebar/DocumentDropzone, ModeSelector | Standalone upload/mode widgets | No tracked consumer found; do not delete without checking external plans/consumers |
| Modals/UserModal, AttachmentsModal, ConfirmModal | Registration/password/OTP/reset/Google; profile/avatar; unified asset preview/search/attach/delete; confirmation | API and App callbacks; document “attach” is UI-only (AUD-018); no isolated modal tests |
| styles/main.css, public/manifest.json, index.html | Theme/base styles, manifest and browser bootstrap | Public images excluded from detailed review; manifest alone does not establish offline PWA support |
| vite.config.ts and tracked vite.config.js, tsconfig*, vercel.json | Plugins/dev proxy/build/compiler/SPA hosting | Duplicate TS/JS config needs build validation before cleanup; tsc -b can emit config artifacts |

## Native modules

| Files | Responsibilities and interfaces | Dependencies / error and test behavior |
| --- | --- | --- |
| index.ts, App.tsx | Expo registration; session/auth/theme/draft/stream state; gestures, history and all modal wiring | AsyncStorage, apiService, FlatList, haptics; no device run performed |
| src/services/api.ts | JSON calls, native multipart XHR, endpoint override, SSE XHR, error extraction | getApiBaseUrl cache; actual split-frame loss reproduced without network; history errors become empty results |
| src/types/index.ts; src/theme/colors.ts | Wire/UI types and native palettes | Independently maintained from web; TypeScript passed |
| src/config/env.ts; components/ServerConfigModal.tsx | Production dev-tool visibility; saved backend override/reset/test | DrawerMenu imports SHOW_DEV_SERVER_CONFIG; API still honors stored overrides; reset/test mismatch AUD-029 |
| components/Header, DrawerMenu | Navigation, theme/temp/new chat; paged sessions/search/pin/rename/delete/profile | Props from App; drawer search filters loaded data rather than backend search |
| components/ChatInput | Text/mode/attachment/reply controls and document picker | expo-document-picker; DOCX offered but not supported by backend |
| components/MessageItem, CitationsSheet | Native text/media/reply/gesture/copy/source rendering | Clipboard, Linking, haptics; no full browser-equivalent rendering/visual verification |
| components/AuthModal, ProfileModal, PasswordStrengthMeter | Password/OTP/register/Google; avatar/password/preferences | Native Google signin and alternate auth paths; mobile recovery parity is incomplete; no device OAuth test |
| components/AttachmentsModal | Paginated/filterable preview/library and attach/delete callbacks | Same backend library; document callback contract defect shared with web |
| app.json, eas.json, package.json, root scripts/deploy-mobile.js/update-mobile.js and .bat wrappers | App identity/assets/native plugins, build profiles and OTA channel | preview OTA path and appVersion runtime policy; no EAS execution or account inspection |
| assets/* and LICENSE | Native artwork and bundled Expo MIT notice | Binary contents excluded; license read, full dependency licensing unreviewed |

## Cross-module change boundaries

Authentication affects every route and both clients plus static/R2 downloads. Retention touches SQL, vectors, object files, process cache and provider policy. A message ID/SSE change touches schemas, orchestrator, persistence, both parsers and reply UI. Document reuse needs a server association model, not only attachment chips. Storage failover affects avatars, uploads, generated images, image references and library URLs.

Preserve these boundaries in future change reviews. No module is declared runtime-tested solely because its files were read.

