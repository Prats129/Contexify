# Assistant privacy and data governance

2026-11-12 update: [Phase 1A](phase-1a-security.md) records the implemented secure-storage migration, isolated bootstrap data flow and key/encryption decisions. Baseline observations below remain historical; processor, jurisdiction and retention proposals still require release review.

Proposed controls, 2026-11-07. This is an engineering privacy assessment; a deployment-specific legal review remains a launch gate. [Source evidence](review-coverage.md), [authorization](permissions.md), [threat model](security-threat-model.md).

## Current baseline and privacy boundary

Verified source: credentials are persisted in web localStorage and native AsyncStorage; general chat persists user messages and derives titles from prompt text. `orchestrator.py` has a query-bearing log in `_execute_web_search`. SQL/files have no application-level encryption implementation found. Hosting/storage encryption, backup location, provider contracts and deployed logging settings were not inspected. These are gaps to resolve before sensitive commands enter those paths, not proof of a production data exposure.

Keep assistant commands outside ordinary chat/RAG history by default. Do not send contacts, messages, schedules, audio or task receipts to analytics, embeddings, search engines or image generation. Private action details may appear in an encrypted local action card/history only. General chat remains governed by its existing behavior until a separately approved migration.

## Data inventory and proposed lifecycle

Retention below is a product target, subject to the legal holds and India gate below; do not advertise unconditional deletion before that gate. Durations must be configuration with reviewed defaults, not undocumented constants.

| Data | Processing and permitted transmission | Storage/protection | Proposed retention/deletion |
| --- | --- | --- | --- |
| Wake audio | Local detector only; no cloud feed | Bounded in-memory ring buffer, at most 2 seconds for later wake experiment | Overwrite continuously; clear on stop; no file/debug recording |
| PTT audio | Local recognizer by default; cloud STT only with specific opt-in and disclosure | RAM stream; no Contexify object storage; if OS/library requires a temporary file, encrypt/exclude backup and remove immediately | Maximum 30-second capture; clear on completion/cancel; provider retention separately documented |
| Transcript/draft message | Local parse; minimal necessary text to reviewed planner only after cloud-processing consent | Volatile local state; encrypted recovery only if explicitly enabled | Clear on cancel/task termination or 15 minutes inactivity; no crash/log body |
| Contacts/destinations | Local picker/resolver; selected alias/opaque handle to planner where possible; exact destination to chosen communications app only | No contact database copy; encrypted selected endpoint only while required | Clear after task; contact changes invalidate prior resolution; exclude message body/number from server audit |
| Calendar/system reminders | Bounded local query; cloud summary requires separate disclosure | No bulk sync, vector index or general conversation cache | Clear query data after response; only user-requested app-owned reminders persist |
| App-owned reminder | OS scheduler + encrypted local metadata; optional future encrypted sync separately approved | Platform-backed key; generic lock-screen notification unless user opts into detail | Until completed/cancelled; optional encrypted history default 30 days, shorter/delete controls |
| Account session/device key | Backend/session boundary only | Token hash server-side; native secure storage; nonexportable signing key; web HttpOnly cookie for assistant | Short-lived assistant authority; revoke on logout/disable; uninstall/restore cannot silently reuse binding |
| Proposal/permit | Server stores IDs, policy and digest; minimize private arguments | Access-controlled SQL; sensitive columns encrypted; permit secret stored hashed | Permit 60 seconds; expired authorization unusable; minimal replay tombstone default 24 hours, then audit projection only |
| Action result/history | Native typed receipt -> backend minimal state; private user history local | Separate encrypted private history and redacted security ledger | Product history 30 days by default; security metadata 90 days proposed outside stricter obligations; adjust legal profile before launch |
| Provider/OAuth secrets | Backend connector only; never mobile/web/LLM | Managed secret store or protected runtime secret injection; encryption for refresh tokens, scoped credentials | Rotate/revoke per provider; delete connector secret on disconnect; bounded failed-job state |
| Telemetry/crash data | Status, timings, capability ID, aggregate counts only | Strict allowlist, pseudonymous IDs, no request/response dumps, screenshots or audio | Operational aggregates 30 days initially; access logs follow legal profile |
| Backup | Only required encrypted stores | Separate keys/access policy; restore applies deletion/revocation ledger before serving | Proposed rolling 30 days unless legal schedule differs; disclose delayed backup expiry |

No plaintext private data at rest in Contexify-controlled stores. Processing necessarily uses plaintext briefly in memory, and the OS or user-chosen messaging app receives content needed to perform its function. Contexify cannot guarantee how a third-party app internally stores that content; disclose this boundary. A hash of a low-entropy phone number/message is not adequate anonymization; avoid storing it or use a keyed, rotating correlation construction when strictly needed.

Mobile secrets use a reviewed secure-storage wrapper such as [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), with backup, uninstall and biometric-change behavior explicitly tested. Device signing requires native key operations; storing an exportable private-key string in SecureStore is not equivalent to a nonexportable key. Use authenticated encryption for larger records with keys protected by [Android Keystore](https://developer.android.com/privacy-and-security/keystore) / [Apple Keychain](https://developer.apple.com/documentation/security/keychain-services). Server sensitive fields use envelope encryption with separated key management and rotation. Web private persistence is disabled initially; browser storage encryption with a JS-accessible key does not solve XSS.

## External processor and data-flow register

| Destination | Current source use / future assistant use | Data crossing boundary and required decision |
| --- | --- | --- |
| Google GenAI | Existing chat/vision/embedding; proposed minimal structured planner | Existing flow includes prompt, bounded history, selected document text or images; assistant gets only opted-in minimal transcript/task context. Verify paid-tier terms, region, retention, subprocessors and model availability |
| Google/other OS speech provider | New recognizer integration | Local-only setting must be verified per locale/device. System service may otherwise transmit audio; no silent fallback |
| Optional cloud STT | New, disabled by default | Utterance audio + language; choose processing region, retention and processor contract before enablement; no vendor keys in client |
| Cloudflare Workers AI | Existing image generation | Image prompt/reference bytes; no assistant private data routed here |
| Turso / SQLite | Existing relational storage | Existing profiles/chat metadata; proposed minimized task metadata and encrypted sensitive fields; cloud region and backup contract unresolved |
| Pinecone / Chroma | Existing retrieval | Existing document chunks/embeddings; no assistant contacts/transcripts/messages or task history |
| R2 / local files | Existing media/document storage | No assistant audio upload bucket; explicit opt-in future export only, ownership checked and encrypted |
| Brevo / SMTP | Existing authentication mail | Email address and challenge delivery; never message drafts or assistant history |
| Google News / Bing / DuckDuckGo | Existing web search | Search query; private commands must never accidentally route to search |
| OS dialer / SMS / WhatsApp | Proposed communication handoff | Exact user-approved destination/body; click-to-chat may place text in URLs/browser history/third-party logs; disclose and prefer supported native composer where available |
| EAS/Expo, app stores, hosting/CDN | Existing distribution and hosting | Binaries, public config, network metadata; no secrets in EXPO_PUBLIC/VITE variables; signed update/provenance controls; service terms review |
| Web fonts/icons/Google Identity script | Existing external browser resources | Browser IP/request metadata and identity flow; self-host optional fonts/icons and narrow script policy where practical |
| Future push/OAuth connectors | Deferred | Opaque task IDs only in push payloads; calendar/business-message data only within consented connector scope; separate DPIA/processor review |

Google's published API pricing distinguishes free/paid data-use terms. Require a reviewed paid-service configuration for sensitive assistant planning; “not used for product improvement” is not a guarantee of zero retention, zero human access or India-only processing. [Gemini terms](https://ai.google.dev/gemini-api/terms), [pricing/data-use table](https://ai.google.dev/gemini-api/docs/pricing). Do not switch providers or tiers on error unless the user's disclosure covers the destination. Tests must inspect network traffic with synthetic fixtures to confirm what SDKs actually transmit.

## Consent, deletion and user controls

Explain microphone versus cloud processing separately, show a persistent recording indicator and stop button, and keep wake disabled by default. Consent records capture purpose, device, capability, processing destination, policy text version and grant/withdrawal time. Offer text-only/local-only behavior when cloud processing is declined. No advertising access or training reuse of private assistant data.

Provide an action history with the exact user-approved transaction and honest outcome, behind unlock; support deletion, export and connector/device revocation. On logout/disable: stop recording, revoke credentials/permits, clear transient content, remove sensitive local caches, and explicitly offer to cancel scheduled reminders. Account deletion must enumerate server, native, OS scheduler, backups and provider deletion limits. Pending deletions use durable jobs; restored backups replay tombstones before exposing data. Do not claim to delete a message already sent through another service.

## India and launch-region gate

As of 2026-11-07, the DPDP framework has phased commencement; do not describe all obligations as already fully effective. The final Rules dated November 2025 commence some rules immediately, Rule 4 after one year, and Rules 3, 5–16, 22–23 after eighteen months. Rule 7 specifies breach notification without delay and detailed Board reporting within 72 hours; Rules 6 and 8 include one-year retention provisions. These materially affect any short deletion promise. Counsel must resolve exact applicable dates, data categories and retention before launch. [Final gazetted DPDP Rules](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).

The Act addresses notice/consent, fiduciary duties, access/correction/erasure/grievance rights, children (under 18), and cross-border restrictions. Assess Contexify's role, lawful processing of third-party contact data, guardian requirements and any significant-fiduciary designation. Proposed initial scope is adults in India; age-gating and an adults-only label still require a defensible process. A consent toggle does not establish legal compliance. [India Code Act and commencement annotations](https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf).

Assess CERT-In applicability with counsel: covered entities must report specified incidents within six hours and securely retain relevant ICT logs for 180 days within India. Do not meet this by indiscriminately recording audio/messages; define necessary security metadata and escalation ownership. [CERT-In directions and official FAQs](https://www.cert-in.org.in/Directions70B.jsp). Reconcile this with the later DPDP retention obligations and processor contracts in a signed retention schedule; the 90-day engineering default above must not override a legal requirement.

Other deployment regions are unresolved. Do not launch there by assumption: perform jurisdiction-specific GDPR/UK/privacy and children's-data review, transfer/processor review, and store privacy-label/Data Safety review when those regions are selected. Before beta, assign a privacy owner, publish notices and grievance contact, rehearse export/deletion/breach workflows, and approve the actual processor/region/retention register. No claim of complete legal compliance follows from this document.
