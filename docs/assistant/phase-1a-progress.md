# Phase 1A implementation checkpoint

Authorized by the user on 2026-11-12: "so let's start phase 1A". Starting HEAD: `413ed7477584af8a8798957003f59e338c20831f`; clean worktree. This authorizes local Phase 1A implementation and tests, not deployment or later execution capabilities.

## Scope and batches

1. Secure native credential storage with controlled legacy migration; enforce release HTTPS/server origin before network or credential access.
2. Additive versioned security schema, fresh-auth enrollment, device proof-of-possession, bounded scoped sessions and revocation. Isolate browser assistant authority behind HttpOnly cookies plus exact Origin and CSRF checks. Keep existing chat bearer compatibility.
3. Native nonexportable signing key module and client enrollment/session helpers. No action executor, voice capture or private task persistence in this phase.
4. Redacted security diagnostics, strict assistant validation, response headers, encryption/key-management decisions and privacy inventory.
5. Isolated authorization/replay/concurrency/restore/migration tests, both client type checks and existing regression checks. Native compile/device/store verification must be reported separately.

## Status

- Backend security enrollment, exact-origin HTTPS/CSRF/cookie boundary, strict schemas, one-use device proofs, scoped management sessions, revocation and versioned additive migration implemented. Security flag defaults to disabled. See [implementation details](phase-1a-security.md).
- Native credentials moved to SecureStore with serialized migration/failure handling. Release API selection ignores development overrides and requires the configured HTTPS origin. Native Kotlin/Swift P-256 key module and explicit client bootstrap hooks added. App runtime version is now 1.2.0; no binary or update was built/published.
- Both TypeScript checks, generated contract checks, 16 new backend security tests, 10 configuration tests, 147 existing client tests, 10 new security/storage client tests, 29 scroll tests and 4 keyboard tests pass in isolated/static environments. Android and Apple autolinking resolve the new module and SecureStore; no native compile/device result is claimed.
- Initial full backend run: 435 tests, one history-ordering failure and two legacy-upgrade errors. The migration errors were fixed by including the new timestamp in fresh auth-table creation. The existing history-window fixture assumed insertion order despite tied wall-clock timestamps; made that fixture's timestamps deterministic without changing production history behavior. All four affected SQLite/Turso cases pass on targeted rerun. **Full rerun: 435 tests passed in 336.980 seconds (exit 0)**. The new assistant suite separately passes after final Origin/ownership hardening.
- Source implementation and isolated/static verification are complete. **Phase 1A production-readiness remains open** for actual native builds, physical-device key/storage/reinstall checks, deployed cookie/TLS/redirect topology and operational restore/revocation procedures. No deployment or later execution phase is enabled. Resume from these release gates and git diff; do not contact configured services, read user data or run application startup/migrations against configured data by default.
- Region/provider/retention decisions remain release gates; no external processor or infrastructure is being provisioned.

## Follow-up scope, security and efficiency review

The user requested a review for unnecessary changes, security and efficiency after the implementation. The Phase 1A scope and staged diff were rechecked. No unrelated product-feature changes were identified; the only new runtime package is Expo SecureStore, and the backend crypto library was already hash-locked.

Two concrete improvements were made: browser/native bootstrap and private responses now reject a changed parent login, including account changes while response bodies arrive; expired-row cleanup is bounded to 100 rows per table per bootstrap, with expired rows excluded from quotas and account indexes supporting those lookups. The indexes extend the unreleased migration version 1; no deployed database migration was edited or run. Browser account identity uses an in-memory SHA-256 fingerprint, not another persisted credential.

Follow-up verification: **17 assistant backend tests and 14 security/storage client tests passed**, along with both TypeScript checks, generated contracts and diff whitespace checks. The earlier full 435-case backend run remains earlier evidence; it was not rerun for these isolated assistant-only refinements. Native compilation/device checks and deployment/restore gates remain open; this is not a zero-vulnerability or benchmark certification. Additional review changes remain unstaged beside the user's existing staged Phase 1A changes.
