# Phase 1A security implementation and verification

Authorized scope: local Phase 1A implementation, 2026-11-12. Starting source: `413ed7477584af8a8798957003f59e338c20831f`. This adds security enrollment/session infrastructure; later planning, voice and device effects remain disabled/unimplemented. No deployment, real database migration, production settings change or store submission has been performed.

## Implemented boundary

The opt-in `/api/v1/assistant/security` router is independent of chat, model, search, audio and task persistence. `ASSISTANT_SECURITY_ENABLED` defaults to false. Enabling requires an explicit HTTPS API origin, explicit web origins and an explicit CORS allowlist. The ASGI trusted scheme must be HTTPS; arbitrary forwarded headers do not satisfy this check. Deployment must configure its trusted TLS proxy correctly. No assistant credential authorizes an existing chat endpoint or an OS action.

Existing account credentials remain compatible with old chat clients. A new server-only `authenticated_at` field records actual password/OTP/Google sign-in issuance; legacy rows default to zero and cannot bootstrap assistant authority. Fresh sign-in is limited to five minutes, challenges to 60 seconds, and management sessions to 15 minutes or the earlier parent expiry. Password changes and logout invalidate the parent session relationship. Issuing a management session does not refresh the underlying authentication time.

Native enrollment requires a P-256 public key and a signature over the exact server-issued UTF-8 JSON payload. It binds protocol, purpose, nonce, account, parent login, installation, platform, key, configured API origin, expiry and (for later session bootstrap) device. Use X9.63 uncompressed public keys in canonical base64 and DER/X9.62 ECDSA-SHA256 signatures. The server validates key format and signature, enforces quotas, and atomically consumes the challenge and publishes enrollment/session state in one SQL transaction. Replay and concurrent consumption have only one winner.

Session scope is currently only `security:manage`: read status/device list and revoke an owned device/session. Native sessions require proof of the enrolled key; ordinary chat bearers are rejected at management endpoints. Revocation is account-scoped and immediately denies new online sessions. This is not the Phase 2 action-permit protocol: there is no action executor, transaction confirmation, command delegation, remote device dispatch or offline sensitive authority.

Browser bootstrap uses a fresh account bearer only for the exchange. Assistant authority thereafter is an HttpOnly, Secure, `__Host-` cookie with `SameSite=Strict`, no Domain and Path `/`. Exact allowed Origin plus an explicit request header and a server-stored CSRF token are required even for private reads. When a browser omits Origin on same-origin GET/HEAD, only `Sec-Fetch-Site: same-origin` can supply provenance, and the API origin must itself be an allowed web origin; writes and cross-site reads never use this fallback. Sessions are bound to the initiating web origin and API origin. Cookie credentials cannot be reused as mobile bearer credentials. The browser helper retains only CSRF/expiry metadata in memory, never the assistant credential. Reload/expiry requires another explicit enable; logout cancels local authority and revokes the parent.

The primary web chat bearer transport remains as before, including its localStorage credential. Its migration is deliberately separate from the assistant cookie boundary to preserve existing API behavior. This means ASST-001 is addressed for assistant authority and native credentials, not a claim that browser XSS or all historical plaintext chat storage is solved. Same-origin XSS can still act as a user; HttpOnly protects against reading the assistant cookie, not against all XSS actions.

## Native storage and key decisions

Native chat credentials now use Expo SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, dedicated keychain service). Valid legacy AsyncStorage credentials migrate through a serialized read/write/readback/remove sequence; secure storage wins over a stale restored plaintext copy. Malformed/expired legacy records are removed. Failed migration removes the old plaintext copy and requires sign-in; it never selects a plaintext fallback. A missing native module fails closed. Mobile web uses memory-only credentials. Only credential keys are migrated; preferences and conversation content are not modified.

The local Expo module `assistant-device-security` implements P-256 key creation, bounded bootstrap-payload signing and deletion. Android private keys remain in Android Keystore; device lock and visible-activity checks guard operations, and supported API levels set unlocked-device-required. Hardware-backed storage is device-dependent; no server attestation claim is made. iOS requires Secure Enclave and an unlocked passcode-protected active app, with a device-only Keychain item; there is no software-key fallback. The private key never enters JavaScript. Device binding metadata is stored in SecureStore; a separate non-backed-up native installation marker prevents restored metadata from silently signing on a replacement installation. A missing marker/key requires new enrollment and revocation of stale server registration.

Phase 1A checks key possession and unlocked state, not action-bound biometric confirmation. That stronger trusted confirmation and execution gate belongs to Phase 2/6 and remains mandatory before effects. The server verifies possession, not hardware attestation or an uncompromised OS. Native `createKey` is intended only for explicit enrollment UI; this phase exposes typed client service hooks without an automatic enrollment side effect or new product onboarding flow.

Release mobile transport selects its configured HTTPS API URL, ignoring saved development overrides. A release binary cannot enable development transport by changing `EXPO_PUBLIC_APP_ENV`. Switching to a different server is rejected. Development builds retain local HTTP support for ordinary chat; assistant enrollment always requires HTTPS. Host-bound credentials are checked before use. Restoring/migrating a chat credential does not create a fresh authentication timestamp or enrolled device.

The native dependency changes require a **new binary**. App/package version is now **1.2.0**, so the existing appVersion runtime policy prevents a native module change from being delivered as a matching 1.1.0 OTA. No EAS build/update has been run. Native integration requires a development/release build; existing Expo Go installations cannot validate the custom signing module. Autolinking discovery is not a native compile or device-security test.

## Privacy, encryption and HTTP decisions

Security request schemas reject extra fields: there is no command/transcript/audio/message field. Pydantic validation errors never reflect input values. Security bodies are limited to 4096 bytes including chunked bodies; compression and query-string parameters are rejected. Responses use no-store, no-referrer, nosniff, frame denial, a restrictive API CSP and disabled capture permissions. No assistant request body or token is emitted as telemetry. The known direct-query log in the existing orchestrator was replaced with a fixed event message.

At rest in the new server tables: public keys, pseudonymous account/device IDs, non-secret binding/expiry metadata, and hashes of random session/CSRF credentials. No raw account/assistant token, contact book, private action text, audio or private task content is persisted there. Challenges contain only bootstrap metadata. Runtime input is held in memory for verification. Expired security records are pruned during security bootstrap. Revoked device rows are retained as revocation records for now, pending the reviewed retention profile; device listing is bounded. No claim of automatic legal retention compliance is made.

Encryption decision: use platform storage for device secrets; do not add custom crypto or a duplicate encryption layer around public keys/hash-only server credentials. Any later private assistant history/arguments/connector secrets require authenticated encryption with separated managed keys, rotation and restore tests **before** adding persistence. Backend `cryptography` 50.0.0 was already hash-locked and installed; it is now also declared as a direct dependency for proof verification. No private-record cipher or key provisioning is silently installed. Existing chat SQL/files, hosting encryption and broader operational logs retain their previous scope and require separate review before private assistant data can enter them.

The privacy inventory in [privacy.md](privacy.md) still governs future data flows. No cloud AI/speech/provider integration was added or contacted. Region/age/processor/retention decisions and legal review remain launch gates, including the India rules already identified. No raw audio recording or third-party messaging data is collected by this phase.

## API and integration surface

| Endpoint under `/api/v1/assistant/security` | Authority and result |
| --- | --- |
| POST `/enrollment/challenge` | Fresh registered account bearer; strict public key/installation/platform; one-use enrollment payload |
| POST `/enrollment` | Same fresh parent bearer and signed payload; enrolls this key only |
| POST `/device-session/challenge` | Current registered account bearer and owned, unrevoked device; one-use session payload |
| POST `/device-session` | Same parent bearer and key proof; short-lived management token |
| POST `/web-session` | Fresh registered bearer, exact Origin and explicit header, empty JSON object; cookie plus CSRF metadata |
| GET `/session`, GET `/devices` | Scoped device bearer or origin-bound cookie plus CSRF; no general account bearer |
| DELETE `/devices/{device_id}` | Management authority and ownership; revokes device sessions/challenges |
| DELETE `/session` | Management authority; removes scoped session and browser cookie |

Schemas generate both client contract files. `apiService.assistantSecurity` exposes explicit browser enable/status/devices/revoke/disable and native enroll/openSession/forget hooks for the future UI. `forget` destroys local binding; remote revocation is a separate confirmed management operation, and an uncertain enrollment result must be reviewed in the device list before retrying. Parent logout cancels in-flight client bootstrap results and invalidates scoped server authority. A remembered enrolled key may prove possession after a later registered login; it never grants blanket consent for actions.

Browser deployments need a same-site/same-origin API arrangement compatible with `SameSite=Strict` cookies and credentialed CORS. A separate Vercel site and unrelated Render API domain cannot assume third-party cookies will work; use an approved same-origin reverse proxy/domain arrangement in deployment work. CSP here protects API responses; a full SPA CSP rollout must test existing Google Identity, fonts, images and streaming destinations before enforcement. Do not weaken cookie/Origin policy just to accommodate a deployment.

## Migration, rollback and restore

`assistant_schema_versions` records version 1 inside the existing initialization transaction. It adds `auth_sessions.authenticated_at` (default zero) and dedicated devices/challenges/security-session tables/indexes. Repeated initialization is idempotent. No startup was run against application configuration. Tests use in-memory/disposable SQLite and loopback Turso HTTP fixtures; live Turso behavior is not inferred from them.

Rollback: disable assistant security first, revoke online sessions/devices when necessary, and ship a compatible binary/update. Retain additive tables/columns and migration history; do not drop/reverse them while supported clients exist. Old chat clients remain compatible with the expanded auth table. Native credential migration is one-way: do not copy secure tokens back to AsyncStorage. An older binary may require fresh login; it must not receive assistant authority.

Restoring a database from before a revocation can restore old authorization records. Deployment restore must apply an external revocation/tombstone journal or conservatively revoke all assistant devices/sessions and force fresh enrollment before exposing the restored service. The local fixture verifies that a backup containing a revocation preserves it; it cannot prove a pre-revocation backup knows about later changes. This remains an operational gate, not a solved distributed-state property.

## Verification and remaining release gates

Implementation tests and final results are recorded in [phase checkpoint](phase-1a-progress.md). No native OS compiler, Android SDK/Gradle project, Xcode/macOS environment or physical phone verification was available in this Windows session. Before enabling the feature in any deployed environment, build both adapters and test key nonexportability, lock/unlock/background behavior, SecureStore migration failure, reinstall/backup restore, TLS/redirect behavior, cookie/CORS topology, and device revocation on physical devices.

Phase 1A source changes are reviewable; its production readiness gate remains open until those native and operational checks are performed. Phase 2 must retain the current fail-closed default and add policy/permit/confirmation protocols before any device effect is enabled. The original platform audit is historical; [review-coverage.md](review-coverage.md) retains its baseline rather than relabelling old checks as current.

Implementation references: [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Expo native modules](https://docs.expo.dev/modules/get-started/), [Android Keystore](https://developer.android.com/privacy-and-security/keystore), [Apple Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [ECDSA verification](https://cryptography.io/en/latest/hazmat/primitives/asymmetric/ec/).

Follow-up hardening: client bootstrap/private responses are bound to the current parent login so a late response cannot cross an account switch. The browser keeps only a fingerprint for this comparison. Cleanup deletes at most 100 expired rows from each security table per bootstrap; active quota checks exclude expired rows even while a cleanup backlog exists. Account indexes support those checks. See the [follow-up verification record](phase-1a-progress.md).
