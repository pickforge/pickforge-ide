/** The one place that turns a caught `unknown` into a display string: an
 *  `Error`'s message, or `String(...)` for anything else (a thrown string,
 *  a rejection value, etc). Was duplicated across a dozen-plus call sites. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
