// OS keychain seam for provider credentials.
//
// WHY: an API key is a credential, and web storage on the app origin is readable
// by anything running in that webview — including the ciphertext key next to it.
// The only storage that is not "next to the ciphertext" is the operating
// system credential store. In the Tauri shell that is Secret Service (Linux),
// Keychain (macOS) or Credential Manager (Windows), reached through Rust's
// `keyring` crate.
//
// In a plain browser (vitest/jest, `vite dev` outside Tauri) there is no
// keychain. This module then reports unavailable and the store keeps the key in
// memory only — it must NEVER fall back to localStorage. See
// `docs/prereg/2026-11-11-keychain-and-consent.md`, H3.

const SERVICE = "study-studio";

export interface KeychainAdapter {
  set(providerId: string, secret: string): Promise<boolean>;
  get(providerId: string): Promise<string | null>;
  delete(providerId: string): Promise<boolean>;
}

let adapter: KeychainAdapter | null = null;
let available: boolean | null = null;

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): Invoke | null {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  return internals && typeof internals.invoke === "function" ? internals.invoke.bind(internals) : null;
}

const tauriAdapter: KeychainAdapter = {
  async set(providerId, secret) {
    const invoke = tauriInvoke();
    if (!invoke) return false;
    try {
      await invoke("keychain_set", { service: SERVICE, account: providerId, secret });
      return true;
    } catch {
      return false;
    }
  },
  async get(providerId) {
    const invoke = tauriInvoke();
    if (!invoke) return null;
    try {
      const value = await invoke("keychain_get", { service: SERVICE, account: providerId });
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  },
  async delete(providerId) {
    const invoke = tauriInvoke();
    if (!invoke) return false;
    try {
      await invoke("keychain_delete", { service: SERVICE, account: providerId });
      return true;
    } catch {
      return false;
    }
  },
};

function active(): KeychainAdapter {
  return adapter ?? tauriAdapter;
}

/** Write one secret. Returns false when no keychain backend is available. */
export async function keychainSet(providerId: string, secret: string): Promise<boolean> {
  const ok = await active().set(providerId, secret);
  if (!ok) available = false;
  else available = true;
  return ok;
}

/** Read one secret, or null when absent/unavailable. */
export async function keychainGet(providerId: string): Promise<string | null> {
  const value = await active().get(providerId);
  if (value !== null) available = true;
  return value;
}

export async function keychainDelete(providerId: string): Promise<boolean> {
  return active().delete(providerId);
}

/**
 * Whether the last keychain operation succeeded. `null` means "not attempted
 * yet"; callers must treat that as unknown, not as available.
 */
export function isKeychainAvailable(): boolean | null {
  return available;
}

/** Test seam: inject an adapter (or restore the Tauri adapter with null). */
export function __setKeychainAdapter(next: KeychainAdapter | null): void {
  adapter = next;
  available = null;
}
