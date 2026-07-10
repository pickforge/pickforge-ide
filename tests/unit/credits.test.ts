import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  session: null as { userId: string } | null,
  rpc: vi.fn(),
  invoke: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("../../src/lib/proAuth", () => ({
  getProSupabaseClient: () => ({ rpc: env.rpc, functions: { invoke: env.invoke } }),
}));

vi.mock("../../src/stores/account", () => ({
  accountSession: () => env.session,
}));

vi.mock("../../src/lib/opener", () => ({
  openExternalUrl: env.openExternalUrl,
}));

async function loadCredits() {
  vi.resetModules();
  return import("../../src/stores/credits");
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  env.session = { userId: "user-1" };
  env.rpc.mockReset();
  env.invoke.mockReset();
  env.openExternalUrl.mockReset().mockResolvedValue(undefined);
});

describe("credits store", () => {
  it("refreshes the balance from the RPC when signed in", async () => {
    env.rpc.mockResolvedValue({ data: 148, error: null });
    const credits = await loadCredits();

    expect(credits.creditBalanceCents()).toBeNull();
    await credits.refreshCreditBalance();
    expect(env.rpc).toHaveBeenCalledWith("credit_balance_cents");
    expect(credits.creditBalanceCents()).toBe(148);
  });

  it("clears the balance and never calls the RPC when signed out", async () => {
    const credits = await loadCredits();
    credits.setCreditBalanceCents(50);
    env.session = null;

    await credits.refreshCreditBalance();
    expect(credits.creditBalanceCents()).toBeNull();
    expect(env.rpc).not.toHaveBeenCalled();
    await expect(credits.getCreditBalanceCents()).resolves.toBeNull();
  });

  it("keeps the last known balance when the RPC fails", async () => {
    const credits = await loadCredits();
    env.rpc.mockResolvedValue({ data: 200, error: null });
    await credits.refreshCreditBalance();
    expect(credits.creditBalanceCents()).toBe(200);

    env.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await credits.refreshCreditBalance();
    expect(credits.creditBalanceCents()).toBe(200);
  });

  it("starts checkout and opens the returned URL externally", async () => {
    env.invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/session" }, error: null });
    const credits = await loadCredits();

    await credits.startCreditCheckout("p25");

    expect(env.invoke).toHaveBeenCalledWith("create-credit-checkout", { body: { pack: "p25" } });
    expect(env.openExternalUrl).toHaveBeenCalledWith("https://checkout.stripe.com/session");
  });

  it("clears the cached balance when the session ends", async () => {
    env.rpc.mockResolvedValue({ data: 148, error: null });
    const credits = await loadCredits();

    // The bootstrap subscribes this exact reconcile to the account session; drive
    // it directly since Solid effects don't flush under the node (SSR) test build.
    credits.reconcileCreditsForSession();
    credits.setCreditBalanceCents(148);

    env.session = null;
    credits.reconcileCreditsForSession();
    expect(credits.creditBalanceCents()).toBeNull();
  });

  it("resets then refreshes the balance when the user switches (A → B)", async () => {
    const credits = await loadCredits();

    env.session = { userId: "user-A" };
    credits.reconcileCreditsForSession();
    credits.setCreditBalanceCents(500);
    expect(credits.creditBalanceCents()).toBe(500);

    // Auth swaps A for B with no null in between; B must not see A's 500.
    env.rpc.mockResolvedValue({ data: 20, error: null });
    env.session = { userId: "user-B" };
    credits.reconcileCreditsForSession();
    expect(credits.creditBalanceCents()).toBeNull();

    await flushMicrotasks();
    expect(credits.creditBalanceCents()).toBe(20);
    expect(env.rpc).toHaveBeenCalled();
  });

  it("throws and does not open a URL when checkout omits one", async () => {
    env.invoke.mockResolvedValue({ data: {}, error: null });
    const credits = await loadCredits();

    await expect(credits.startCreditCheckout("p10")).rejects.toThrow(/url/);
    expect(env.openExternalUrl).not.toHaveBeenCalled();
  });
});
