import { invoke } from "@tauri-apps/api/core";
import { getProSupabaseClient } from "./proAuth";
import { signOut } from "../stores/account";

export type ExportResult =
  | { ok: true; saved: boolean; path: string | null }
  | { ok: false; message: string };

export type DeleteFailureReason = "retry" | "sessionExpired" | "error";

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: DeleteFailureReason; message: string };

export function exportFileName(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `pickforge-data-${yyyy}-${mm}-${dd}.json`;
}

/** The account section enables the destructive confirm only on an exact match of
 *  the literal word DELETE or the signed-in email (both trimmed). */
export function deleteConfirmMatches(input: string, email: string | null): boolean {
  const value = input.trim();
  if (value === "DELETE") return true;
  const target = email?.trim();
  return !!target && value.toLowerCase() === target.toLowerCase();
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function errorStatus(error: unknown): number | null {
  const status = (error as { context?: { status?: unknown } })?.context?.status;
  return typeof status === "number" ? status : null;
}

async function errorBody(error: unknown): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: unknown })?.context as
    | { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> }
    | undefined;
  if (!context) return null;
  try {
    const body =
      typeof context.clone === "function"
        ? await context.clone().json()
        : typeof context.json === "function"
          ? await context.json()
          : null;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Fetch a portable copy of the account data from the Edge Function and write it
 *  to a user-chosen file via the native Save-As dialog. `saved: false` means the
 *  user cancelled the dialog. */
export async function exportAccountData(): Promise<ExportResult> {
  try {
    const { data, error } = await getProSupabaseClient().functions.invoke(
      "export-account-data",
      { body: {} },
    );
    if (error) return { ok: false, message: errorMessage(error) };
    if (!data || typeof data !== "object") {
      return { ok: false, message: "Export returned no data." };
    }
    const contents = `${JSON.stringify(data, null, 2)}\n`;
    const path = await invoke<string | null>("save_text_file", {
      defaultName: exportFileName(),
      contents,
    });
    return { ok: true, saved: path !== null, path };
  } catch (value) {
    return { ok: false, message: errorMessage(value) };
  }
}

/** Permanently delete the account via the Edge Function. On a transient failure
 *  (`deletion_incomplete`/5xx) the account is untouched and the caller must keep
 *  the user signed in; a 401 means the session expired. */
export async function deleteAccount(): Promise<DeleteResult> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await getProSupabaseClient().functions.invoke("delete-account", {
      body: {},
    }));
  } catch (value) {
    return { ok: false, reason: "error", message: errorMessage(value) };
  }

  if (error) {
    const status = errorStatus(error);
    if (status === 401) {
      return { ok: false, reason: "sessionExpired", message: "Your session expired. Sign in again." };
    }
    const body = await errorBody(error);
    if ((status !== null && status >= 500) || body?.error === "deletion_incomplete") {
      return {
        ok: false,
        reason: "retry",
        message: "Couldn't complete deletion — please try again in a moment.",
      };
    }
    return { ok: false, reason: "error", message: errorMessage(error) };
  }

  if ((data as { deleted?: unknown })?.deleted === true) return { ok: true };
  return { ok: false, reason: "error", message: "Deletion did not complete." };
}

/** Delete the account and, on success or an expired session, sign out to clear
 *  local account state so the UI returns to signed-out. A transient failure
 *  keeps the user signed in and surfaces a retry message. */
export async function performAccountDeletion(): Promise<DeleteResult> {
  const result = await deleteAccount();
  if (result.ok || result.reason === "sessionExpired") {
    await signOut();
  }
  return result;
}
