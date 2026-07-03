// Pure helpers for the orchestration handoff (no Solid/Tauri imports so they can
// be unit-tested in isolation). `buildWorkingDiff` concatenates per-file diffs
// and caps the total length with a truncation note; `fillDiffTemplate` slots a
// payload into a prompt template's {{diff}} placeholder.

export const DIFF_CHAR_CAP = 24000;

export interface WorkingDiffPart {
  path: string;
  diff: string;
}

export function buildWorkingDiff(parts: WorkingDiffPart[], cap = DIFF_CHAR_CAP): string {
  const blocks = parts
    .map((part) => part.diff.replace(/\s+$/, ""))
    .filter((diff) => diff.trim().length > 0);
  if (blocks.length === 0) return "";

  let out = "";
  let truncated = false;
  for (const block of blocks) {
    const next = out.length === 0 ? block : `${out}\n\n${block}`;
    if (next.length > cap) {
      out = next.slice(0, cap);
      truncated = true;
      break;
    }
    out = next;
  }
  if (truncated) out += `\n\n… diff truncated at ${cap} characters …`;
  return out;
}

export function fillDiffTemplate(body: string, diff: string): string {
  return body.replace(/\{\{diff\}\}/g, diff);
}
