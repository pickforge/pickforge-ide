import {
  createPickforgeAuthClient,
  type PickforgeAuthClient,
  type PickforgeOAuthProvider,
} from "@pickforge/auth";
import { openExternalUrl } from "./opener";
import {
  PICKFORGE_PRO_REDIRECT_URI,
  PICKFORGE_PRO_SUPABASE_ANON_KEY,
  PICKFORGE_PRO_SUPABASE_URL,
} from "./proConfig";

const STORAGE_PREFIX = "pickforge.proAuth.";

let client: PickforgeAuthClient | null = null;
let redirectInFlight = false;

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function tauriAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ === "object"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "pickforge:" &&
      url.hostname === "auth" &&
      (url.pathname === "/callback" || url.pathname === "/callback/")
    );
  } catch {
    return false;
  }
}

async function shouldHandleRedirect(): Promise<boolean> {
  try {
    const store = await import("../stores/account");
    return store.shouldHandleAccountRedirect();
  } catch {
    return false;
  }
}

async function routeRedirectError(error: unknown) {
  const message = errorMessage(error);
  try {
    const store = await import("../stores/account");
    if (store.shouldHandleAccountRedirect()) {
      store.setAccountRedirectError(message);
    } else {
      releaseProAuthRedirectGuard();
    }
  } catch {
    releaseProAuthRedirectGuard();
    console.error("[pickforge] auth redirect failed", message);
  }
}

async function deliverCallbackUrl(url: string, listener: (url: string) => void | Promise<void>) {
  if (!isAuthCallbackUrl(url)) return;
  if (redirectInFlight) return;
  if (!(await shouldHandleRedirect())) {
    redirectInFlight = false;
    return;
  }

  redirectInFlight = true;
  void listener(url);
}

function deliverCallbackUrls(urls: string[] | null, listener: (url: string) => void | Promise<void>) {
  for (const url of urls ?? []) {
    void deliverCallbackUrl(url, listener);
  }
}

export function releaseProAuthRedirectGuard() {
  redirectInFlight = false;
}

export function getProAuthClient(): PickforgeAuthClient {
  if (client) return client;
  if (!tauriAvailable()) {
    throw new Error("PickForge account sign-in requires the desktop runtime");
  }

  client = createPickforgeAuthClient({
    supabaseUrl: PICKFORGE_PRO_SUPABASE_URL,
    supabaseAnonKey: PICKFORGE_PRO_SUPABASE_ANON_KEY,
    redirectUri: PICKFORGE_PRO_REDIRECT_URI,
    storage: {
      getItem: (key) => localStorage.getItem(storageKey(key)),
      setItem: (key, value) => localStorage.setItem(storageKey(key), value),
      removeItem: (key) => localStorage.removeItem(storageKey(key)),
    },
    openExternalUrl,
    redirectListener: {
      listen(listener) {
        let disposed = false;
        let unlisten: (() => void) | null = null;

        void import("@tauri-apps/plugin-deep-link")
          .then(async ({ getCurrent, onOpenUrl }) => {
            unlisten = await onOpenUrl((urls) => deliverCallbackUrls(urls, listener));
            deliverCallbackUrls(await getCurrent(), listener);
            if (disposed) {
              unlisten();
              unlisten = null;
            }
          })
          .catch((error) => void routeRedirectError(error));

        return () => {
          disposed = true;
          unlisten?.();
          unlisten = null;
        };
      },
    },
    onRedirectError: routeRedirectError,
  });

  return client;
}

export type { PickforgeOAuthProvider };
