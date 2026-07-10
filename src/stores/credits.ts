import { createEffect, createRoot, createSignal } from "solid-js";
import { openExternalUrl } from "../lib/opener";
import { getProSupabaseClient } from "../lib/proAuth";
import { accountSession } from "./account";

export type CreditPack = "p10" | "p25" | "p50";

export interface CreditPackOption {
  pack: CreditPack;
  priceLabel: string;
}

export const CREDIT_PACKS: CreditPackOption[] = [
  { pack: "p10", priceLabel: "$10" },
  { pack: "p25", priceLabel: "$25" },
  { pack: "p50", priceLabel: "$50" },
];

const CREDIT_BALANCE_RPC = "credit_balance_cents";
const CREDIT_CHECKOUT_FUNCTION = "create-credit-checkout";

const [balanceCents, setBalanceCents] = createSignal<number | null>(null);
export const creditBalanceCents = balanceCents;

export function setCreditBalanceCents(value: number | null) {
  setBalanceCents(value);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : fallback;
}

export async function getCreditBalanceCents(): Promise<number | null> {
  if (!accountSession()) return null;
  const { data, error } = await getProSupabaseClient().rpc(CREDIT_BALANCE_RPC);
  if (error) throw new Error(errorMessage(error, "credit balance lookup failed"));
  const value = typeof data === "number" ? data : Number(data);
  return Number.isFinite(value) ? value : null;
}

export async function refreshCreditBalance(): Promise<void> {
  if (!accountSession()) {
    setBalanceCents(null);
    return;
  }
  try {
    const value = await getCreditBalanceCents();
    if (value !== null) setBalanceCents(value);
  } catch {
    // Balance is advisory; keep the last known value when the read fails.
  }
}

export async function startCreditCheckout(pack: CreditPack): Promise<void> {
  const { data, error } = await getProSupabaseClient().functions.invoke(CREDIT_CHECKOUT_FUNCTION, {
    body: { pack },
  });
  if (error) throw new Error(errorMessage(error, "checkout could not start"));
  const url = data && typeof data === "object" ? (data as { url?: unknown }).url : null;
  if (typeof url !== "string" || !url) throw new Error("checkout url missing");
  await openExternalUrl(url);
}

let bootstrapDisposer: (() => void) | null = null;
let reconciledUserId: string | null = null;

/** Keep the cached balance honest against whoever is signed in. On sign-out the
 *  balance clears; on a user switch (userId A → B with no null between) the old
 *  user's balance is dropped immediately and the new user's is fetched, so B
 *  never sees A's stale credits. */
export function reconcileCreditsForSession(): void {
  const userId = accountSession()?.userId ?? null;
  if (!userId) {
    reconciledUserId = null;
    setBalanceCents(null);
    return;
  }
  if (userId === reconciledUserId) return;
  reconciledUserId = userId;
  setBalanceCents(null);
  void refreshCreditBalance();
}

/** Wire the balance reconcile to the account session. Safe to call once at app start. */
export function installCreditsBootstrap(): () => void {
  if (bootstrapDisposer) return bootstrapDisposer;
  let disposeRoot = () => {};
  createRoot((dispose) => {
    disposeRoot = dispose;
    createEffect(reconcileCreditsForSession);
  });
  bootstrapDisposer = () => {
    disposeRoot();
    bootstrapDisposer = null;
  };
  return bootstrapDisposer;
}
