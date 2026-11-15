# Pre-registration — hosted-provider consent + OS keychain (S-2, N-S-1)

**Date:** 2026-11-11
**Author:** agent, under owner authorization (DECIDE item 8: "Keep OpenAI/OpenRouter
behind explicit consent. Approve a keychain dependency (e.g. keyring) for
Study-Studio instead of hand-rolled crypto — agent may add it (Zone Y,
pre-registered).")
**Constitution:** Hatem_specific.md C23 (pre-register) and §5 Zone Y (new runtime
dependency + security behaviour).

## Problem

1. **N-S-1 / CodeQL clear-text storage.** Provider API keys are stored in
   localStorage. The current code encrypts them with AES-GCM (a 2026-11 change), but the
   AES key is stored in a second localStorage slot on the same origin. That is
   obfuscation with extra steps: anything that can read one slot can read both.
   It is not an OS keychain and it does not satisfy the finding.
2. **S-2 privacy claim.** The build can reach `api.openai.com` and `openrouter.ai`
   and lets a user configure a key, while the README claims work stays on the
   machine. The claim is only true if the user never enables a hosted provider,
   and nothing in the UI enforces that choice.

## Hypothesis

H1: after this change, **no API key is written to web storage at all**; it is
written to the OS credential store (Secret Service / Keychain / Credential
Manager) through Rust's `keyring` crate, and only a non-secret config
(base URL) stays in localStorage.

H2: a hosted provider cannot be configured or used until the user has made an
explicit per-provider consent decision, and that decision is recorded.

H3: when no OS keychain backend exists (headless Linux, plain browser), the app
**does not silently fall back to web storage**. Keys stay in memory for the
session and the UI is told persistence is unavailable.

## Metric and data

- Static: `grep` over the built web bundle and the storage writes for the
  literal key value after configuration — must be absent from localStorage.
- Unit: the provider-store test suite, including new consent and no-storage
  assertions, run with `pnpm --filter @study-studio/desktop test` (or the
  workspace equivalent).
- Manual/automated: configure a key with the keychain mocked to succeed →
  assert `secret_set` was called and localStorage has no key material;
  mock keychain failure → assert in-memory only and `keychainAvailable=false`.

## Accept / reject rules (written before the run)

**Accept** all of:
1. no code path writes an API key into `localStorage`/ `sessionStorage`;
2. `setProviderConfig` refuses to store a hosted key until
   `setHostedConsent(id, true)` has been called for that provider;
3. `keychainAvailable === false` produces in-memory-only behaviour, never a
   web-storage write;
4. the existing store tests pass after migration, and new tests cover 1–3.

**Reject** (finding stays open, report the number):
- any fallback that writes the key to web storage;
- consent that is implied by saving a key rather than a separate action;
- a "keychain" that is another web-storage slot.

## Rollback

Single commit; revert restores the previous AES-in-localStorage behaviour. The
Rust dependency is additive; removing it restores the build.

## Not covered

- No user-facing passphrase/Stronghold vault is added. The OS keychain is the
  trust anchor; a locked keychain makes persistence fail closed (H3).
- No claim is made that the desktop bundle has been exercised on macOS or
  Windows in this session; the Rust command compiles and is type-checked here.
