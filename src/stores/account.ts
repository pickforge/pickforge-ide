import { createSignal } from "solid-js";
import type { PickforgeEntitlement, PickforgeOAuthProvider } from "@pickforge/auth";
import { getProAuthClient, releaseProAuthRedirectGuard } from "../lib/proAuth";
import { flagEnabled, subscribeToFlagChanges } from "./flags";

export type AccountStatus = "signedOut" | "signingIn" | "signedIn" | "error";

export interface AccountSession {
  email: string | null;
  displayName: string | null;
  userId: string;
}

export type AccountEntitlement = PickforgeEntitlement;

const CACHE_KEY = "pickforge.proAccount";
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

interface AccountCache {
  version: 1;
  session: AccountSession;
  entitlements: AccountEntitlement[];
}

interface InitOptions {
  hydrate?: boolean;
  refresh?: boolean;
}

interface RefreshOptions {
  forceRefresh?: boolean;
  refreshSession?: boolean;
  silent?: boolean;
}

const [session, setSession] = createSignal<AccountSession | null>(null);
const [entitlements, setEntitlements] = createSignal<AccountEntitlement[]>([]);
const [status, setStatus] = createSignal<AccountStatus>("signedOut");
const [error, setError] = createSignal<string | null>(null);

export const accountSession = session;
export const accountEntitlements = () => activeEntitlements(entitlements());
export const accountStatus = status;
export const accountError = error;

let initialized = false;
let signInTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeAuth: (() => void) | null = null;
let unsubscribeBootstrap: (() => void) | null = null;
let refreshGeneration = 0;

function accountsEnabled(): boolean {
  return flagEnabled("accounts");
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function networkLikeError(value: unknown): boolean {
  if (value instanceof TypeError) return true;
  const message = errorMessage(value).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("load failed") ||
    message.includes("connection")
  );
}

function redirectErrorMessage(message: string): string {
  const cleaned = message
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/pickforge:\/\/\S+/gi, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^OAuth redirect failed:\s*/i, "")
    .trim();
  if (!cleaned) return "Sign-in failed. Try again.";
  const reason = cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
  return `Sign-in failed: ${reason}`;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function activeEntitlements(items: AccountEntitlement[], now = Date.now()): AccountEntitlement[] {
  return items.filter((item) => {
    if (item.expiresAt === null) return true;
    const expiresAt = Date.parse(item.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

function readEntitlement(value: unknown): AccountEntitlement | null {
  const record = recordOf(value);
  if (!record) return null;
  const key = stringOrNull(record.key);
  const grantedAt = stringOrNull(record.grantedAt);
  if (record.expiresAt !== null && typeof record.expiresAt !== "string") return null;
  if (!key || !grantedAt) return null;
  const expiresAt = record.expiresAt;
  return {
    key,
    value: record.value === undefined ? true : (record.value as AccountEntitlement["value"]),
    expiresAt,
    grantedAt,
  };
}

function readSession(value: unknown): AccountSession | null {
  const record = recordOf(value);
  const userId = stringOrNull(record?.userId);
  if (!userId) return null;
  return {
    userId,
    email: stringOrNull(record?.email),
    displayName: stringOrNull(record?.displayName),
  };
}

function loadCache(): AccountCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = recordOf(JSON.parse(raw));
    const session = readSession(parsed?.session);
    if (!session) return null;
    const rawEntitlements = Array.isArray(parsed?.entitlements) ? parsed.entitlements : [];
    const entitlements = activeEntitlements(
      rawEntitlements
        .map(readEntitlement)
        .filter((item): item is AccountEntitlement => item !== null),
    );
    return { version: 1, session, entitlements };
  } catch {
    return null;
  }
}

function persistCache(nextSession: AccountSession | null, nextEntitlements: AccountEntitlement[]) {
  try {
    if (!nextSession) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: nextSession,
        entitlements: activeEntitlements(nextEntitlements),
      }),
    );
  } catch {
  }
}

function sessionFromAuth(authSession: unknown): AccountSession | null {
  const user = recordOf(recordOf(authSession)?.user);
  const userId = stringOrNull(user?.id);
  if (!userId) return null;
  const metadata = recordOf(user?.user_metadata);
  const displayName =
    stringOrNull(metadata?.full_name) ??
    stringOrNull(metadata?.name) ??
    stringOrNull(metadata?.user_name) ??
    stringOrNull(metadata?.preferred_username);
  return {
    userId,
    email: stringOrNull(user?.email),
    displayName,
  };
}

function clearSignInTimer() {
  if (signInTimer) {
    clearTimeout(signInTimer);
    signInTimer = null;
  }
}

function setSignedOut(options: { clearCache?: boolean } = {}) {
  clearSignInTimer();
  releaseProAuthRedirectGuard();
  setSession(null);
  setEntitlements([]);
  setStatus("signedOut");
  setError(null);
  if (options.clearCache !== false) persistCache(null, []);
}

function setSignedIn(nextSession: AccountSession, nextEntitlements: AccountEntitlement[]) {
  clearSignInTimer();
  releaseProAuthRedirectGuard();
  const active = activeEntitlements(nextEntitlements);
  setSession(nextSession);
  setEntitlements(active);
  setStatus("signedIn");
  setError(null);
  persistCache(nextSession, active);
}

function setAccountError(value: unknown) {
  clearSignInTimer();
  releaseProAuthRedirectGuard();
  setStatus("error");
  setError(errorMessage(value));
}

async function refreshFromAuth(options: RefreshOptions = {}) {
  if (!accountsEnabled()) return;
  const generation = ++refreshGeneration;
  let nextSession: AccountSession | null = null;
  try {
    const auth = getProAuthClient();
    const authSession = options.refreshSession ? await auth.refreshSession() : await auth.getSession();
    if (generation !== refreshGeneration) return;
    if (!options.refreshSession && status() === "signingIn") return;
    nextSession = sessionFromAuth(authSession);
    if (!nextSession) {
      setSignedOut({ clearCache: false });
      return;
    }
  } catch (value) {
    if (generation !== refreshGeneration) return;
    if (options.silent && !options.refreshSession && status() === "signingIn") return;
    if (options.silent && networkLikeError(value)) return;
    if (options.silent && session() !== null) setSignedOut({ clearCache: true });
    setAccountError(value);
    return;
  }
  if (!nextSession) return;
  if (generation !== refreshGeneration) return;

  const cachedEntitlements = session()?.userId === nextSession.userId ? entitlements() : [];
  setSession(nextSession);
  setEntitlements(activeEntitlements(cachedEntitlements));
  setStatus("signedIn");
  setError(null);
  persistCache(nextSession, cachedEntitlements);

  try {
    const auth = getProAuthClient();
    const nextEntitlements = await auth.getEntitlements({ forceRefresh: options.forceRefresh });
    if (generation !== refreshGeneration) return;
    if (!options.refreshSession && status() === "signingIn") return;
    setSignedIn(nextSession, nextEntitlements);
  } catch (value) {
    if (generation !== refreshGeneration) return;
    if (options.silent && networkLikeError(value)) return;
    setEntitlements([]);
    persistCache(nextSession, []);
    setAccountError(value);
  }
}

export async function initAccountStore(options: InitOptions = {}) {
  if (!accountsEnabled()) return;
  const hydrate = options.hydrate !== false;
  const refresh = options.refresh !== false;
  if (initialized) {
    if (refresh) await refreshFromAuth({ forceRefresh: true, silent: true });
    return;
  }
  initialized = true;

  const cached = hydrate ? loadCache() : null;
  if (cached && status() !== "signingIn") {
    setSignedIn(cached.session, cached.entitlements);
  }

  try {
    const auth = getProAuthClient();
    unsubscribeAuth ??= auth.onAuthStateChange((change) => {
      if (!accountsEnabled()) return;
      if (change.session === null) {
        if (change.event === "INITIAL_SESSION" && status() === "signingIn") return;
        setSignedOut({ clearCache: change.event === "SIGNED_OUT" });
        return;
      }
      void refreshFromAuth({ forceRefresh: true, refreshSession: true, silent: true });
    });
  } catch (value) {
    initialized = false;
    if (!cached) setAccountError(value);
    return;
  }

  if (refresh) await refreshFromAuth({ forceRefresh: true, silent: true });
}

export async function signIn(provider: PickforgeOAuthProvider) {
  if (!accountsEnabled()) return;
  releaseProAuthRedirectGuard();
  clearSignInTimer();
  setStatus("signingIn");
  setError(null);
  signInTimer = setTimeout(() => {
    if (status() === "signingIn") {
      releaseProAuthRedirectGuard();
      setSession(null);
      setEntitlements([]);
      setStatus("signedOut");
      setError("Sign-in timed out. Try again when the browser flow finishes.");
    }
  }, SIGN_IN_TIMEOUT_MS);
  await initAccountStore({ hydrate: false, refresh: false });
  if (!accountsEnabled()) return;

  try {
    await getProAuthClient().startOAuth(provider);
  } catch (value) {
    setAccountError(value);
  }
}

export function cancelSignIn() {
  if (!accountsEnabled()) return;
  clearSignInTimer();
  releaseProAuthRedirectGuard();
  setStatus(session() ? "signedIn" : "signedOut");
  setError(null);
}

export async function signOut() {
  if (!accountsEnabled()) return;
  refreshGeneration += 1;
  clearSignInTimer();
  setError(null);
  let signOutError: unknown = null;
  try {
    await getProAuthClient().signOut();
  } catch (value) {
    signOutError = value;
  }
  setSignedOut({ clearCache: true });
  if (signOutError !== null) setError(errorMessage(signOutError));
}

export function setAccountRedirectError(message: string) {
  if (!shouldHandleAccountRedirect()) return;
  setAccountError(redirectErrorMessage(message));
}

export function shouldHandleAccountRedirect(): boolean {
  return accountsEnabled() && status() === "signingIn";
}

export function installAccountStoreBootstrap(): () => void {
  if (!unsubscribeBootstrap) {
    const initWhenEnabled = () => {
      if (flagEnabled("accounts")) void initAccountStore();
    };
    initWhenEnabled();
    unsubscribeBootstrap = subscribeToFlagChanges(initWhenEnabled);
  }
  return () => {
    unsubscribeBootstrap?.();
    unsubscribeBootstrap = null;
  };
}

export function hasProEntitlement(): boolean {
  return accountEntitlements().some((item) => item.key === "pro" && item.value !== false);
}
