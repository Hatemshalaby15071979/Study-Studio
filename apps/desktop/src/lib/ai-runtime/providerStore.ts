// Runtime-configurable provider state (API keys + base-URL overrides).
//
// Providers are constructed once at module load with no credentials (the local
// OpenAI-compatible profiles have no key; Ollama needs none). This module is
// the single source of truth for *user-supplied* configuration that has to
// survive an app restart: online API keys and any base-URL override.
//
// Storage backend: localStorage (same store lessons/journeys use). Works
// identically inside the Tauri webview and a plain browser — no new
// infrastructure, no Rust dependency. Keys are kept client-side only and are
// never logged.
//
// All functions are defensive: they never throw. A missing/unavailable
// localStorage (SSR, privacy mode) degrades to in-memory state.

import type { AIRuntime } from "./runtime";
import type { AIProvider } from "./types";

const STORAGE_KEY = "study-studio-provider-config";
// Separate slot for the AES-GCM key: the config blob and the key that unlocks
// it live apart, so a casual read of one yields nothing usable.
const KEY_STORAGE_KEY = "study-studio-provider-config-key";

/** Persistent, per-provider user configuration. */
export interface ProviderConfig {
  /** Bearer key for hosted OpenAI-compatible providers. Empty = none. */
  apiKey?: string;
  /** Base-URL override (self-hosted endpoints). Empty = profile default. */
  baseUrl?: string;
}

type ProviderConfigMap = Record<string, ProviderConfig>;

// In-memory mirror so reads work even when localStorage is unavailable, and so
// a config set during a single session is consistent across calls. It is the
// authoritative, synchronous source of truth; persistence is encrypted and
// best-effort (see persist()).
let cache: ProviderConfigMap = {};
let loadPromise: Promise<void> | null = null;
let persistPromise: Promise<void> | null = null;

// ─── encryption at rest ──────────────────────────────────────────────────
// API keys are credentials. They are encrypted with AES-GCM before they touch
// localStorage; the per-install key lives in a SEPARATE storage slot so a
// casual read of the config blob yields nothing usable. This is defence-in-
// depth against at-rest / accidental disclosure (backups, sync, stray reads).
// It is NOT a substitute for an OS keychain — that is the stronger control and
// would require wiring a Tauri secret plugin, which is a recommended follow-up.

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  // Back the view with an explicit ArrayBuffer so the resulting Uint8Array is
  // typed as `Uint8Array<ArrayBuffer>` and is directly assignable to the
  // `BufferSource` parameters of `crypto.subtle` (a bare `Uint8Array` is
  // `Uint8Array<ArrayBufferLike>`, which newer TS DOM lib types reject).
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getCryptoKey(): Promise<CryptoKey> {
  const storage = globalThis.localStorage;
  if (storage) {
    const raw = storage.getItem(KEY_STORAGE_KEY);
    if (raw) {
      try {
        return await globalThis.crypto.subtle.importKey(
          "raw",
          b64ToBytes(raw),
          { name: "AES-GCM" },
          true,
          ["encrypt", "decrypt"]
        );
      } catch {
        // Corrupt key slot — regenerate below.
      }
    }
  }
  const key = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  if (storage) {
    storage.setItem(
      KEY_STORAGE_KEY,
      bytesToB64(new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", key)))
    );
  }
  return key;
}

async function loadInto(): Promise<void> {
  if (typeof window === "undefined" || !globalThis.localStorage) return;
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = {};
      return;
    }
    // Preferred path: our AES-GCM envelope (`<iv>:<ciphertext>`).
    const sep = raw.indexOf(":");
    if (sep > -1) {
      try {
        const key = await getCryptoKey();
        const iv = b64ToBytes(raw.slice(0, sep));
        const data = b64ToBytes(raw.slice(sep + 1));
        const plain = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
        const parsed = JSON.parse(new TextDecoder().decode(plain));
        cache = parsed && typeof parsed === "object" ? (parsed as ProviderConfigMap) : {};
        return;
      } catch {
        // Not our envelope (or it failed to decrypt) — fall through.
      }
    }
    // Legacy migration: earlier builds stored raw JSON. Adopt it; the next
    // persist() re-encrypts it. Invalid content degrades to empty.
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === "object" ? (parsed as ProviderConfigMap) : {};
  } catch {
    cache = {};
  }
}

/** Ensure persisted config has been read into the in-memory cache. */
export function ensureConfigLoaded(): Promise<void> {
  if (!loadPromise) loadPromise = loadInto();
  return loadPromise;
}

async function persist(): Promise<void> {
  if (typeof window === "undefined" || !globalThis.localStorage) return;
  try {
    const key = await getCryptoKey();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(cache))
    );
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      `${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`
    );
  } catch {
    // Quota / privacy mode / crypto unavailable — state still lives in-memory.
  }
}

/** Test helper: resolve once any in-flight persistence has settled. */
export function flushPersistence(): Promise<void> {
  return persistPromise ?? Promise.resolve();
}

// Begin loading persisted config as early as possible.
void ensureConfigLoaded();

/** Read the stored config for a provider (or all providers when id omitted). */
export function getProviderConfig(id: string): ProviderConfig {
  return { ...(cache[id] ?? {}) };
}
export function getAllProviderConfigs(): ProviderConfigMap {
  const out: ProviderConfigMap = {};
  for (const [id, cfg] of Object.entries(cache)) out[id] = { ...cfg };
  return out;
}

/** Whether a non-empty API key is stored for the provider. */
export function hasApiKey(id: string): boolean {
  return Boolean(cache[id]?.apiKey);
}

/**
 * Persist config for a provider. Only defined fields are written; passing
 * `undefined` for a field clears it. Merges with existing stored values.
 */
export function setProviderConfig(id: string, cfg: ProviderConfig): void {
  if (!id) return;
  const current = cache[id] ?? {};
  const next: ProviderConfig = { ...current };
  if (cfg.apiKey !== undefined) {
    next.apiKey = cfg.apiKey ? cfg.apiKey.trim() : undefined;
  }
  if (cfg.baseUrl !== undefined) {
    next.baseUrl = cfg.baseUrl ? cfg.baseUrl.trim() : undefined;
  }
  cache[id] = next;
  persistPromise = persist();
}

/** Remove all stored config for a provider (e.g. user clears their key). */
export function clearProviderConfig(id: string): void {
  if (!id) return;
  delete cache[id];
  persistPromise = persist();
}

/**
 * Apply a stored config to a provider instance via its optional mutators.
 * No-op for providers without mutators (Ollama) or with no stored config.
 * Never throws.
 */
export function applyConfig(provider: AIProvider): void {
  const cfg = cache[provider.descriptor.id];
  if (!cfg) return;
  try {
    if (cfg.apiKey && provider.setApiKey) provider.setApiKey(cfg.apiKey);
    if (cfg.baseUrl && provider.setBaseUrl) provider.setBaseUrl(cfg.baseUrl);
  } catch {
    // Reconfiguration is best-effort; never block on it.
  }
}

/**
 * Apply ALL stored configs to every provider in a runtime. Called once at
 * module load (before the first discovery) and again from the Settings page
 * after the user edits a key.
 */
export function applyStoredConfigs(runtime: AIRuntime): void {
  for (const provider of runtime.providers.all()) applyConfig(provider);
}
