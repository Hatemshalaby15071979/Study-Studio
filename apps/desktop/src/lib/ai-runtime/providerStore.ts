// Runtime-configurable provider state (API keys + base-URL overrides).
//
// Providers are constructed once at module load with no credentials. This module
// is the single source of truth for user-supplied configuration that has to
// survive a restart: online API keys and base-URL overrides.
//
// STORAGE RULES (audit S-2, N-S-1; see docs/prereg/2026-11-11-keychain-and-consent.md):
//
//   * an API key is NEVER written to localStorage/sessionStorage. It goes to the
//     OS keychain through ./keychain (Rust `keyring`), or it stays in memory for
//     the session when no keychain exists;
//   * only non-secret config (base URL) is persisted to web storage;
//   * a hosted provider (OpenAI / OpenRouter) cannot be configured or applied
//     until the user gives explicit per-provider consent.
//
// All functions are defensive: they never throw. Missing storage degrades to
// in-memory state.

import type { AIRuntime } from "./runtime";
import type { AIProvider } from "./types";
import { ONLINE_PROVIDER_IDS } from "./providerIds";
import { keychainDelete, keychainGet, keychainSet } from "./keychain";

const STORAGE_KEY = "study-studio-provider-config";
// Legacy AES envelope key slot. Read once to migrate an old build, then deleted.
const KEY_STORAGE_KEY = "study-studio-provider-config-key";
const CONSENT_KEY = "study-studio-hosted-consent";

/** Persistent, per-provider user configuration. */
export interface ProviderConfig {
  /** Bearer key for hosted OpenAI-compatible providers. Empty = none. */
  apiKey?: string;
  /** Base-URL override (self-hosted endpoints). Empty = profile default. */
  baseUrl?: string;
}

type ProviderConfigMap = Record<string, ProviderConfig>;

let cache: ProviderConfigMap = {};
let loadPromise: Promise<void> | null = null;
let persistPromise: Promise<void> | null = null;
let lastKeyRefusal: string | null = null;

const HOSTED = new Set<string>(ONLINE_PROVIDER_IDS);

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── hosted-provider consent ─────────────────────────────────────────────
let consent: Record<string, boolean> = loadConsent();

function loadConsent(): Record<string, boolean> {
  try {
    const raw = storage()?.getItem(CONSENT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return isObject(parsed) ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function isHostedProvider(id: string): boolean {
  return HOSTED.has(id);
}

/** Record an explicit decision about sending data to a hosted provider. */
export function setHostedConsent(id: string, granted: boolean): void {
  if (!id) return;
  if (granted) consent[id] = true;
  else delete consent[id];
  try {
    storage()?.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    // Consent still applies for this session.
  }
}

export function hasHostedConsent(id: string): boolean {
  return consent[id] === true;
}

/** The provider whose key write was last refused for missing consent. */
export function getLastKeyRefusal(): string | null {
  return lastKeyRefusal;
}

// ─── legacy AES envelope (migration only) ────────────────────────────────
// Earlier builds encrypted the config blob with a key stored in a second
// localStorage slot. That is not a keychain, so it is replaced. These two
// helpers exist only to read an old install once and move its keys into the
// keychain; nothing encrypts to web storage any more.
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decryptLegacyEnvelope(raw: string): Promise<ProviderConfigMap | null> {
  const s = storage();
  if (!s) return null;
  const sep = raw.indexOf(":");
  if (sep < 1) return null;
  const rawKey = s.getItem(KEY_STORAGE_KEY);
  if (!rawKey) return null;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      b64ToBytes(rawKey),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const iv = b64ToBytes(raw.slice(0, sep));
    const data = b64ToBytes(raw.slice(sep + 1));
    const plain = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    return isObject(parsed) ? (parsed as ProviderConfigMap) : null;
  } catch {
    return null;
  }
}

async function loadInto(): Promise<void> {
  const s = storage();
  cache = {};
  let legacyKeyMaterial = false;

  if (s) {
    let raw: string | null = null;
    try {
      raw = s.getItem(STORAGE_KEY);
    } catch {
      // A storage that throws on read (privacy mode) means "nothing stored".
      raw = null;
    }
    if (raw) {
      let parsed: unknown = null;
      // A JSON blob starts with "{"; anything else is a legacy `<iv>:<ciphertext>`
      // envelope. Testing for ":" alone is wrong — a base URL contains one.
      if (!raw.trimStart().startsWith("{")) {
        parsed = await decryptLegacyEnvelope(raw);
        legacyKeyMaterial = parsed !== null;
      } else {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }
      if (isObject(parsed)) {
        for (const [id, value] of Object.entries(parsed)) {
          if (!isObject(value)) continue;
          const safe: ProviderConfig = {};
          if (typeof value["baseUrl"] === "string" && value["baseUrl"]) safe.baseUrl = value["baseUrl"];
          if (typeof value["apiKey"] === "string" && value["apiKey"]) {
            safe.apiKey = value["apiKey"];
            legacyKeyMaterial = true;
          }
          cache[id] = safe;
        }
      }
    }
  }

  // The keychain is the source of truth for keys. Read every hosted provider and
  // every provider we already know about.
  const ids = new Set<string>([...Object.keys(cache), ...ONLINE_PROVIDER_IDS]);
  for (const id of ids) {
    const secret = await keychainGet(id);
    if (secret) cache[id] = { ...(cache[id] ?? {}), apiKey: secret };
  }

  // Move any key found in web storage into the keychain, then rewrite storage
  // without it. If the keychain is unavailable the key stays in memory only.
  if (legacyKeyMaterial) {
    await persist();
    try {
      s?.removeItem(KEY_STORAGE_KEY);
    } catch {
      // best effort
    }
  }
}

/** Ensure persisted config has been read into the in-memory cache. */
export function ensureConfigLoaded(): Promise<void> {
  if (!loadPromise) loadPromise = loadInto();
  return loadPromise;
}

async function persist(): Promise<void> {
  const s = storage();
  if (!s) return;
  const publicConfig: Record<string, { baseUrl: string }> = {};
  const keyOps: Promise<boolean>[] = [];
  for (const [id, cfg] of Object.entries(cache)) {
    if (cfg.baseUrl) publicConfig[id] = { baseUrl: cfg.baseUrl };
    if (cfg.apiKey) keyOps.push(keychainSet(id, cfg.apiKey));
    else keyOps.push(keychainDelete(id));
  }
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(publicConfig));
  } catch {
    // Quota / privacy mode — state still lives in memory.
  }
  await Promise.all(keyOps);
}

/** Test helper: resolve once any in-flight persistence has settled. */
export function flushPersistence(): Promise<void> {
  return persistPromise ?? Promise.resolve();
}

// Begin loading persisted config as early as possible.
void ensureConfigLoaded();

/** Read the stored config for a provider (no key when consent is missing). */
export function getProviderConfig(id: string): ProviderConfig {
  const cfg = cache[id] ?? {};
  const out: ProviderConfig = {};
  if (cfg.baseUrl) out.baseUrl = cfg.baseUrl;
  if (cfg.apiKey && (!isHostedProvider(id) || hasHostedConsent(id))) out.apiKey = cfg.apiKey;
  return out;
}

export function getAllProviderConfigs(): ProviderConfigMap {
  const out: ProviderConfigMap = {};
  for (const id of Object.keys(cache)) {
    const cfg = getProviderConfig(id);
    if (Object.keys(cfg).length) out[id] = cfg;
  }
  return out;
}

/** Whether a usable API key is stored for the provider. */
export function hasApiKey(id: string): boolean {
  return Boolean(cache[id]?.apiKey) && (!isHostedProvider(id) || hasHostedConsent(id));
}

/**
 * Persist config for a provider. Only defined fields are written; passing
 * `undefined` for a field clears it. Merges with existing stored values.
 *
 * A hosted provider key is refused (and recorded in `getLastKeyRefusal()`)
 * until `setHostedConsent(id, true)` has been called.
 */
export function setProviderConfig(id: string, cfg: ProviderConfig): void {
  if (!id) return;
  const current = cache[id] ?? {};
  const next: ProviderConfig = { ...current };
  if (cfg.apiKey !== undefined) {
    const trimmed = cfg.apiKey ? cfg.apiKey.trim() : "";
    if (trimmed && isHostedProvider(id) && !hasHostedConsent(id)) {
      lastKeyRefusal = id;
    } else {
      next.apiKey = trimmed || undefined;
      if (trimmed) lastKeyRefusal = null;
    }
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
 * A hosted key is applied only with explicit consent. Never throws.
 */
export function applyConfig(provider: AIProvider): void {
  const id = provider.descriptor.id;
  const cfg = cache[id];
  if (!cfg) return;
  try {
    if (cfg.apiKey && (!isHostedProvider(id) || hasHostedConsent(id)) && provider.setApiKey) {
      provider.setApiKey(cfg.apiKey);
    }
    if (cfg.baseUrl && provider.setBaseUrl) provider.setBaseUrl(cfg.baseUrl);
  } catch {
    // Reconfiguration is best-effort; never block on it.
  }
}

/**
 * Apply ALL stored configs to every provider in a runtime. Called once at
 * module load (before the first discovery) and again from Settings after an
 * edit.
 */
export function applyStoredConfigs(runtime: AIRuntime): void {
  for (const provider of runtime.providers.all()) applyConfig(provider);
}
