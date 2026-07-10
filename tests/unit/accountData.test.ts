import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  invoke: vi.fn(),
  functionsInvoke: vi.fn(),
  signOut: vi.fn(),
  currentUserId: null as string | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: env.invoke,
}));

vi.mock("../../src/lib/proAuth", () => ({
  getProSupabaseClient: () => ({
    functions: { invoke: env.functionsInvoke },
  }),
}));

vi.mock("../../src/stores/account", () => ({
  signOut: env.signOut,
  accountSession: () => (env.currentUserId ? { userId: env.currentUserId } : null),
}));

import {
  deleteAccount,
  deleteConfirmMatches,
  exportAccountData,
  exportFileName,
  performAccountDeletion,
} from "../../src/lib/accountData";

beforeEach(() => {
  vi.clearAllMocks();
  env.signOut.mockResolvedValue(undefined);
  env.currentUserId = null;
});

describe("exportFileName", () => {
  it("formats a dated json filename", () => {
    expect(exportFileName(new Date("2026-03-09T12:00:00Z"))).toBe(
      "pickforge-data-2026-03-09.json",
    );
  });
});

describe("deleteConfirmMatches", () => {
  it("matches the literal DELETE (trimmed, case-sensitive)", () => {
    expect(deleteConfirmMatches("DELETE", null)).toBe(true);
    expect(deleteConfirmMatches("  DELETE  ", null)).toBe(true);
    expect(deleteConfirmMatches("delete", null)).toBe(false);
    expect(deleteConfirmMatches("", null)).toBe(false);
  });

  it("matches the account email case-insensitively", () => {
    expect(deleteConfirmMatches("user@pickforge.dev", "user@pickforge.dev")).toBe(true);
    expect(deleteConfirmMatches("USER@pickforge.dev", "user@pickforge.dev")).toBe(true);
    expect(deleteConfirmMatches("other@pickforge.dev", "user@pickforge.dev")).toBe(false);
  });
});

describe("exportAccountData", () => {
  it("writes the pretty-printed JSON to the chosen path on success", async () => {
    const payload = {
      version: 1,
      exportedAt: "2026-03-09T00:00:00.000Z",
      profile: { id: "user-1" },
      entitlements: [],
      creditLedger: [],
      syncedSettings: [],
      billing: { hasStripeCustomer: false, stripeCustomerId: null },
    };
    env.functionsInvoke.mockResolvedValue({ data: payload, error: null });
    env.invoke.mockResolvedValue("/home/user/pickforge-data-2026-03-09.json");

    const result = await exportAccountData();

    expect(env.functionsInvoke).toHaveBeenCalledWith("export-account-data", { body: {} });
    const [command, args] = env.invoke.mock.calls[0];
    expect(command).toBe("save_text_file");
    expect(args.contents).toBe(`${JSON.stringify(payload, null, 2)}\n`);
    expect(JSON.parse(args.contents)).toEqual(payload);
    expect(result).toEqual({
      ok: true,
      saved: true,
      path: "/home/user/pickforge-data-2026-03-09.json",
    });
  });

  it("reports saved:false when the user cancels the dialog", async () => {
    env.functionsInvoke.mockResolvedValue({ data: { version: 1 }, error: null });
    env.invoke.mockResolvedValue(null);

    const result = await exportAccountData();

    expect(result).toEqual({ ok: true, saved: false, path: null });
  });

  it("surfaces an error and never writes a file when the function fails", async () => {
    env.functionsInvoke.mockResolvedValue({ data: null, error: new Error("boom") });

    const result = await exportAccountData();

    expect(result).toEqual({ ok: false, message: "boom" });
    expect(env.invoke).not.toHaveBeenCalled();
  });

  it("aborts without writing when the account changed before the write", async () => {
    // Fetch succeeds (user A) but the session switched to B by the time it lands.
    env.functionsInvoke.mockResolvedValue({
      data: { version: 1, profile: { id: "user-a" } },
      error: null,
    });

    const result = await exportAccountData(() => false);

    expect(result).toEqual({ ok: true, saved: false, path: null });
    expect(env.invoke).not.toHaveBeenCalled();
  });
});

describe("deleteAccount", () => {
  it("succeeds when the function reports deleted:true", async () => {
    env.functionsInvoke.mockResolvedValue({ data: { deleted: true }, error: null });
    expect(await deleteAccount()).toEqual({ ok: true });
  });

  it("returns a retry outcome for a deletion_incomplete 5xx", async () => {
    env.functionsInvoke.mockResolvedValue({
      data: null,
      error: {
        context: { status: 500, clone: () => ({ json: async () => ({ error: "deletion_incomplete" }) }) },
      },
    });
    const result = await deleteAccount();
    expect(result).toEqual({
      ok: false,
      reason: "retry",
      message: "Couldn't complete deletion — please try again in a moment.",
    });
  });

  it("flags an expired session on 401", async () => {
    env.functionsInvoke.mockResolvedValue({
      data: null,
      error: { context: { status: 401, clone: () => ({ json: async () => ({}) }) } },
    });
    const result = await deleteAccount();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("sessionExpired");
  });
});

describe("performAccountDeletion", () => {
  it("signs out and clears state on success", async () => {
    env.functionsInvoke.mockResolvedValue({ data: { deleted: true }, error: null });
    const result = await performAccountDeletion();
    expect(result.ok).toBe(true);
    expect(env.signOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the user signed in and returns retry on deletion_incomplete", async () => {
    env.functionsInvoke.mockResolvedValue({
      data: null,
      error: {
        context: { status: 502, clone: () => ({ json: async () => ({ error: "deletion_incomplete" }) }) },
      },
    });
    const result = await performAccountDeletion();
    expect(result).toEqual({
      ok: false,
      reason: "retry",
      message: "Couldn't complete deletion — please try again in a moment.",
    });
    expect(env.signOut).not.toHaveBeenCalled();
  });

  it("signs out when the session expired", async () => {
    env.functionsInvoke.mockResolvedValue({
      data: null,
      error: { context: { status: 401, clone: () => ({ json: async () => ({}) }) } },
    });
    await performAccountDeletion();
    expect(env.signOut).toHaveBeenCalledTimes(1);
  });

  it("does not sign out a switched-to account when A's deletion completes", async () => {
    env.currentUserId = "user-a";
    env.functionsInvoke.mockImplementation(async () => {
      // The user switched to account B while A's deletion was in flight.
      env.currentUserId = "user-b";
      return { data: { deleted: true }, error: null };
    });
    const result = await performAccountDeletion();
    expect(result.ok).toBe(true);
    expect(env.signOut).not.toHaveBeenCalled();
  });
});
