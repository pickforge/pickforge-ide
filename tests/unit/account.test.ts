import { beforeEach, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;

  const client = {
    startOAuth: vi.fn(),
    handleRedirect: vi.fn(),
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(),
    getEntitlements: vi.fn(),
    onAuthStateChange: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
  };
  return {
    mem,
    client,
    authListener: null as null | ((change: { event: string; session: unknown }) => void),
    getProAuthClient: vi.fn(() => client),
    releaseProAuthRedirectGuard: vi.fn(),
  };
});

vi.mock("../../src/lib/proAuth", () => ({
  getProAuthClient: testEnv.getProAuthClient,
  releaseProAuthRedirectGuard: testEnv.releaseProAuthRedirectGuard,
}));

const CACHE_KEY = "pickforge.proAccount";
const PENDING_SIGN_IN_KEY = "pickforge.proAccount.pendingSignIn";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function authSession(email = "fresh@pickforge.dev") {
  return {
    user: {
      id: "user-1",
      email,
      user_metadata: { full_name: "Fresh User" },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadStores() {
  vi.resetModules();
  const flags = await import("../../src/stores/flags");
  const account = await import("../../src/stores/account");
  return { flags, account };
}

beforeEach(() => {
  testEnv.mem.clear();
  vi.clearAllMocks();
  testEnv.authListener = null;
  testEnv.getProAuthClient.mockReturnValue(testEnv.client);
  testEnv.client.startOAuth.mockResolvedValue({ url: "https://example.com/oauth" });
  testEnv.client.getSession.mockResolvedValue(null);
  testEnv.client.refreshSession.mockResolvedValue(null);
  testEnv.client.signOut.mockResolvedValue(undefined);
  testEnv.client.getEntitlements.mockResolvedValue([]);
  testEnv.client.onAuthStateChange.mockImplementation((listener) => {
    testEnv.authListener = listener;
    return vi.fn();
  });
});

describe("account store", () => {
  it("hydrates cached entitlements and filters expired entries when offline", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        verifiedAt: new Date().toISOString(),
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
          { key: "old", value: true, expiresAt: past, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockRejectedValue(new Error("network offline"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountStatus()).toBe("signedIn");
    expect(account.accountError()).toBeNull();
    expect(account.accountSession()).toEqual({
      userId: "user-1",
      email: "cached@pickforge.dev",
      displayName: "Cached User",
    });
    expect(account.accountEntitlements().map((item) => item.key)).toEqual(["pro"]);
    expect(JSON.parse(testEnv.mem.get(CACHE_KEY)!).entitlements.map((item: { key: string }) => item.key)).toEqual([
      "pro",
    ]);
  });

  it("persists refreshed session identity and active entitlements", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    testEnv.client.getSession.mockResolvedValue(authSession());
    testEnv.client.getEntitlements.mockResolvedValue([
      { key: "old", value: true, expiresAt: past, grantedAt: "2026-01-01T00:00:00.000Z" },
      { key: "pro", value: true, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
    ]);

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountStatus()).toBe("signedIn");
    expect(account.accountSession()).toEqual({
      userId: "user-1",
      email: "fresh@pickforge.dev",
      displayName: "Fresh User",
    });
    expect(account.accountEntitlements().map((item) => item.key)).toEqual(["pro"]);
    expect(testEnv.client.getEntitlements).toHaveBeenCalledWith({ forceRefresh: true });
    expect(JSON.parse(testEnv.mem.get(CACHE_KEY)!)).toMatchObject({
      version: 1,
      session: { userId: "user-1", email: "fresh@pickforge.dev", displayName: "Fresh User" },
      entitlements: [{ key: "pro" }],
    });
  });

  it("keeps cached entitlements silently when entitlement refresh is offline", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        verifiedAt: new Date().toISOString(),
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockResolvedValue(authSession("cached@pickforge.dev"));
    testEnv.client.getEntitlements.mockRejectedValue(new TypeError("Failed to fetch"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountSession()).not.toBeNull();
    expect(account.accountError()).toBeNull();
    expect(account.accountEntitlements().map((item) => item.key)).toEqual(["pro"]);
    expect(JSON.parse(testEnv.mem.get(CACHE_KEY)!).entitlements.map((item: { key: string }) => item.key)).toEqual([
      "pro",
    ]);
  });

  it("does not trust cached Pro after the verification window expires", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        verifiedAt: new Date(Date.now() - 8 * DAY_MS).toISOString(),
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockRejectedValue(new TypeError("Failed to fetch"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountStatus()).toBe("signedIn");
    expect(account.accountSession()).not.toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(account.hasProEntitlement()).toBe(false);
  });

  it("does not trust cached Pro without a verification timestamp", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockRejectedValue(new TypeError("Failed to fetch"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountStatus()).toBe("signedIn");
    expect(account.accountSession()).not.toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(account.hasProEntitlement()).toBe(false);
  });

  it("restores Pro after a successful refresh bumps stale verification", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const staleVerifiedAt = new Date(Date.now() - 8 * DAY_MS).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        verifiedAt: staleVerifiedAt,
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockResolvedValue(authSession("cached@pickforge.dev"));
    testEnv.client.getEntitlements.mockResolvedValue([
      { key: "pro", value: true, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
    ]);

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    const persisted = JSON.parse(testEnv.mem.get(CACHE_KEY)!);
    expect(account.hasProEntitlement()).toBe(true);
    expect(Date.parse(persisted.verifiedAt)).toBeGreaterThan(Date.parse(staleVerifiedAt));
  });

  it("clears cached entitlements and surfaces authoritative entitlement refresh errors", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockResolvedValue(authSession("cached@pickforge.dev"));
    testEnv.client.getEntitlements.mockRejectedValue(new Error("401 entitlement fetch denied"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountSession()).not.toBeNull();
    expect(account.accountStatus()).toBe("error");
    expect(account.accountError()).toBe("401 entitlement fetch denied");
    expect(account.accountEntitlements()).toEqual([]);
    expect(account.hasProEntitlement()).toBe(false);
    expect(JSON.parse(testEnv.mem.get(CACHE_KEY)!)).toMatchObject({
      session: { userId: "user-1" },
      entitlements: [],
    });
  });

  it("filters expired entitlements at read time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      testEnv.client.getSession.mockResolvedValue(authSession());
      testEnv.client.getEntitlements.mockResolvedValue([
        {
          key: "pro",
          value: true,
          expiresAt: "2026-01-01T00:00:01.000Z",
          grantedAt: "2026-01-01T00:00:00.000Z",
        },
      ]);

      const { flags, account } = await loadStores();
      flags.setFlagOverride("accounts", true);

      await account.initAccountStore();
      expect(account.hasProEntitlement()).toBe(true);

      vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));

      expect(account.accountEntitlements()).toEqual([]);
      expect(account.hasProEntitlement()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not grant Pro for a false pro entitlement value", async () => {
    testEnv.client.getSession.mockResolvedValue(authSession());
    testEnv.client.getEntitlements.mockResolvedValue([
      { key: "pro", value: false, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
    ]);

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountEntitlements().map((item) => item.key)).toEqual(["pro"]);
    expect(account.hasProEntitlement()).toBe(false);
  });

  it("does not grant Pro from a cached false pro entitlement value", async () => {
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        verifiedAt: new Date().toISOString(),
        entitlements: [
          { key: "pro", value: false, expiresAt: null, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockRejectedValue(new TypeError("Failed to fetch"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountEntitlements().map((item) => item.key)).toEqual(["pro"]);
    expect(account.hasProEntitlement()).toBe(false);
  });

  it("does not construct the auth client when the flag is disabled", async () => {
    const { account } = await loadStores();

    await account.signIn("github");

    expect(testEnv.getProAuthClient).not.toHaveBeenCalled();
    expect(testEnv.client.startOAuth).not.toHaveBeenCalled();
    expect(account.accountStatus()).toBe("signedOut");
  });

  it("initializes from the app bootstrap when accounts flips on without Settings", async () => {
    const { flags, account } = await loadStores();
    const dispose = account.installAccountStoreBootstrap();

    expect(testEnv.getProAuthClient).not.toHaveBeenCalled();

    flags.setFlagOverride("accounts", true);

    expect(testEnv.getProAuthClient).toHaveBeenCalled();
    expect(testEnv.client.onAuthStateChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("keeps persisted cache on INITIAL_SESSION null but clears it on explicit sign out", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockRejectedValue(new TypeError("Failed to fetch"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();
    expect(account.accountStatus()).toBe("signedIn");
    expect(testEnv.mem.has(CACHE_KEY)).toBe(true);

    testEnv.authListener?.({ event: "INITIAL_SESSION", session: null });

    expect(account.accountStatus()).toBe("signedOut");
    expect(account.accountSession()).toBeNull();
    expect(testEnv.mem.has(CACHE_KEY)).toBe(true);

    await account.signOut();

    expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
  });

  it("clears cached account state when getSession confirms no session", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountStatus()).toBe("signedOut");
    expect(account.accountSession()).toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
  });

  it("clears cached account state when refreshSession confirms no session", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);
    await account.initAccountStore({ refresh: false });

    testEnv.authListener?.({ event: "TOKEN_REFRESHED", session: authSession() });
    await Promise.resolve();
    await Promise.resolve();

    expect(account.accountStatus()).toBe("signedOut");
    expect(account.accountSession()).toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
  });

  it("keeps signingIn through INITIAL_SESSION null and completes on the callback auth event", async () => {
    testEnv.client.refreshSession.mockResolvedValue(authSession("callback@pickforge.dev"));
    testEnv.client.getEntitlements.mockResolvedValue([
      { key: "pro", value: true, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
    ]);

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.signIn("github");
    expect(account.accountStatus()).toBe("signingIn");

    testEnv.authListener?.({ event: "INITIAL_SESSION", session: null });

    expect(account.accountStatus()).toBe("signingIn");
    expect(account.shouldHandleAccountRedirect()).toBe(true);

    testEnv.authListener?.({ event: "SIGNED_IN", session: authSession("callback@pickforge.dev") });
    await Promise.resolve();
    await Promise.resolve();

    expect(account.accountStatus()).toBe("signedIn");
    expect(account.accountSession()?.email).toBe("callback@pickforge.dev");
    expect(account.hasProEntitlement()).toBe(true);
  });

  it("consumes a fresh pending sign-in marker for a cold-start callback", async () => {
    testEnv.mem.set(
      PENDING_SIGN_IN_KEY,
      JSON.stringify({ provider: "github", startedAt: new Date().toISOString() }),
    );
    testEnv.client.refreshSession.mockResolvedValue(authSession("callback@pickforge.dev"));
    testEnv.client.getEntitlements.mockResolvedValue([
      { key: "pro", value: true, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
    ]);

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore({ refresh: false });

    expect(account.consumePendingAccountRedirect()).toBe(true);
    expect(testEnv.mem.has(PENDING_SIGN_IN_KEY)).toBe(false);
    expect(account.accountStatus()).toBe("signingIn");

    testEnv.authListener?.({ event: "SIGNED_IN", session: authSession("callback@pickforge.dev") });
    await Promise.resolve();
    await Promise.resolve();

    expect(account.accountStatus()).toBe("signedIn");
    expect(account.accountSession()?.email).toBe("callback@pickforge.dev");
    expect(account.hasProEntitlement()).toBe(true);
  });

  it("drops a stale pending sign-in marker for a cold-start callback", async () => {
    testEnv.mem.set(
      PENDING_SIGN_IN_KEY,
      JSON.stringify({
        provider: "github",
        startedAt: new Date(Date.now() - 11 * MINUTE_MS).toISOString(),
      }),
    );

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore({ refresh: false });

    expect(account.consumePendingAccountRedirect()).toBe(false);
    expect(testEnv.mem.has(PENDING_SIGN_IN_KEY)).toBe(false);
    expect(account.accountStatus()).toBe("signedOut");
  });

  it("stays signed out when cancelSignIn wins a callback refresh race", async () => {
    const pendingSession = deferred<ReturnType<typeof authSession>>();
    testEnv.client.refreshSession.mockReturnValue(pendingSession.promise);
    testEnv.client.getEntitlements.mockResolvedValue([
      { key: "pro", value: true, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
    ]);

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.signIn("github");
    testEnv.authListener?.({ event: "SIGNED_IN", session: authSession("callback@pickforge.dev") });

    account.cancelSignIn();
    expect(account.accountStatus()).toBe("signedOut");

    pendingSession.resolve(authSession("callback@pickforge.dev"));
    await Promise.resolve();
    await Promise.resolve();

    expect(account.accountStatus()).toBe("signedOut");
    expect(account.accountSession()).toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(testEnv.client.getEntitlements).not.toHaveBeenCalled();
    expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
  });

  it.each(["INITIAL_SESSION", "SIGNED_OUT"])(
    "does not let a stale refresh override a %s null session event",
    async (event) => {
      const pendingSession = deferred<ReturnType<typeof authSession>>();
      testEnv.client.getSession.mockReturnValue(pendingSession.promise);
      testEnv.client.getEntitlements.mockResolvedValue([
        { key: "pro", value: true, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
      ]);

      const { flags, account } = await loadStores();
      flags.setFlagOverride("accounts", true);
      await account.initAccountStore({ refresh: false });

      const refresh = account.initAccountStore();
      testEnv.authListener?.({ event, session: null });

      pendingSession.resolve(authSession("stale@pickforge.dev"));
      await refresh;

      expect(account.accountStatus()).toBe("signedOut");
      expect(account.accountSession()).toBeNull();
      expect(account.accountEntitlements()).toEqual([]);
      expect(testEnv.client.getEntitlements).not.toHaveBeenCalled();
      expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
    },
  );

  it("clears local state and cache when remote sign out fails", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockRejectedValue(new TypeError("Failed to fetch"));
    testEnv.client.signOut.mockRejectedValue(new Error("network unavailable"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();
    await account.signOut();

    expect(account.accountStatus()).toBe("signedOut");
    expect(account.accountSession()).toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(account.accountError()).toBe("network unavailable");
    expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
  });

  it("clears cached session on authoritative startup session refresh failure", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    testEnv.mem.set(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        session: { userId: "user-1", email: "cached@pickforge.dev", displayName: "Cached User" },
        entitlements: [
          { key: "pro", value: true, expiresAt: future, grantedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    testEnv.client.getSession.mockRejectedValue(new Error("invalid refresh token"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountStatus()).toBe("error");
    expect(account.accountError()).toBe("invalid refresh token");
    expect(account.accountSession()).toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
  });

  it("stays signed out when signOut wins a slow startup refresh race", async () => {
    const pendingSession = deferred<ReturnType<typeof authSession>>();
    testEnv.client.getSession.mockReturnValue(pendingSession.promise);
    testEnv.client.getEntitlements.mockResolvedValue([
      { key: "pro", value: true, expiresAt: null, grantedAt: "2026-01-02T00:00:00.000Z" },
    ]);

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    const init = account.initAccountStore();
    await account.signOut();

    pendingSession.resolve(authSession("stale@pickforge.dev"));
    await init;

    expect(account.accountStatus()).toBe("signedOut");
    expect(account.accountSession()).toBeNull();
    expect(account.accountEntitlements()).toEqual([]);
    expect(testEnv.mem.has(CACHE_KEY)).toBe(false);
  });

  it("surfaces non-network auth errors when there is no cache", async () => {
    testEnv.client.getSession.mockRejectedValue(new Error("invalid refresh token"));

    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    await account.initAccountStore();

    expect(account.accountStatus()).toBe("error");
    expect(account.accountError()).toBe("invalid refresh token");
  });

  it("sets signingIn before auth client initialization finishes", async () => {
    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    const pending = account.signIn("github");

    expect(account.accountStatus()).toBe("signingIn");

    await pending;
    account.cancelSignIn();
  });

  it("ignores stale redirect errors and sanitizes active sign-in errors", async () => {
    const { flags, account } = await loadStores();
    flags.setFlagOverride("accounts", true);

    account.setAccountRedirectError("OAuth redirect failed: https://example.com/callback?code=secret\naccess_denied");

    expect(account.accountStatus()).toBe("signedOut");
    expect(account.accountError()).toBeNull();

    await account.signIn("github");
    account.setAccountRedirectError(
      `OAuth redirect failed: https://example.com/callback?code=secret\n${"denied ".repeat(40)}`,
    );

    expect(account.accountStatus()).toBe("error");
    expect(account.accountError()).toMatch(/^Sign-in failed: /);
    expect(account.accountError()).not.toContain("https://");
    expect(account.accountError()).not.toContain("\n");
    expect(account.accountError()!.length).toBeLessThanOrEqual(136);
  });
});
