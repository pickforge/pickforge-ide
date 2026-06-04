#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

source_root=""
out_dir="${PICKFORGE_DIRTY_GIT_DOGFOOD_DIR:-${TMPDIR:-/tmp}/pickforge-dirty-git-project}"
artifact_dir="${PICKFORGE_DIRTY_GIT_DOGFOOD_ARTIFACT_DIR:-build/dogfood/dirty-git}"

usage() {
  cat <<'USAGE'
Usage: scripts/dirty_git_dogfood_setup.sh --source <git-project> [--out-dir <path>] [--artifact-dir <path>]

Creates a disposable git worktree from <git-project>, then seeds staged,
unstaged, and untracked files for Pickforge dirty-worktree dogfood.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --source" >&2
        exit 64
      fi
      source_root="$2"
      shift 2
      ;;
    --out-dir)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --out-dir" >&2
        exit 64
      fi
      out_dir="$2"
      shift 2
      ;;
    --artifact-dir)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --artifact-dir" >&2
        exit 64
      fi
      artifact_dir="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ -z "$source_root" ]]; then
  echo "Missing required --source <git-project>" >&2
  usage >&2
  exit 64
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Missing required command: git" >&2
  exit 1
fi

source_root="$(cd "$source_root" && pwd)"
source_top="$(git -C "$source_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$source_top" ]]; then
  echo "Source is not a git repository: $source_root" >&2
  exit 1
fi
source_top="$(cd "$source_top" && pwd)"

if [[ -n "$(git -C "$source_top" status --porcelain)" ]]; then
  echo "Source repository must be clean before creating a disposable dogfood worktree." >&2
  echo "Source: $source_top" >&2
  git -C "$source_top" status --short >&2
  exit 1
fi

mkdir -p "$(dirname "$out_dir")" "$artifact_dir"
out_abs="$(mkdir -p "$(dirname "$out_dir")" && cd "$(dirname "$out_dir")" && pwd)/$(basename "$out_dir")"
artifact_abs="$(cd "$artifact_dir" && pwd)"
marker_path="$artifact_abs/worktree.path"
legacy_marker=".pickforge-dirty-dogfood-worktree"

if [[ -e "$out_abs" ]]; then
  if [[ ! -f "$out_abs/$legacy_marker" ]] &&
    [[ ! -f "$marker_path" || "$(cat "$marker_path")" != "$out_abs" ]]; then
    echo "Refusing to replace unmarked directory: $out_abs" >&2
    exit 1
  fi
  git -C "$source_top" worktree remove --force "$out_abs" >/dev/null 2>&1 || rm -rf "$out_abs"
fi

git -C "$source_top" worktree add --detach "$out_abs" HEAD >/dev/null
printf '%s\n' "$out_abs" >"$marker_path"

choose_existing_file() {
  local candidate
  for candidate in "$@"; do
    if [[ -f "$out_abs/$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

append_dogfood_marker() {
  local file="$1"
  local label="$2"
  case "$file" in
    *.dart|*.kt|*.kts|*.swift|*.java|*.js|*.ts|*.tsx|*.jsx)
      printf '\n// Pickforge dirty-git dogfood %s change.\n' "$label" >>"$out_abs/$file"
      ;;
    *.yaml|*.yml|*.toml|*.properties)
      printf '\n# Pickforge dirty-git dogfood %s change.\n' "$label" >>"$out_abs/$file"
      ;;
    *)
      printf '\n<!-- Pickforge dirty-git dogfood %s change. -->\n' "$label" >>"$out_abs/$file"
      ;;
  esac
}

staged_file="$(choose_existing_file README.md pubspec.yaml lib/main.dart || true)"
unstaged_file="$(choose_existing_file NEXT_STEPS.md lib/main.dart pubspec.yaml README.md || true)"
if [[ -z "$staged_file" || -z "$unstaged_file" ]]; then
  echo "Could not find suitable tracked files to dirty in: $out_abs" >&2
  exit 1
fi

append_dogfood_marker "$staged_file" "staged"
git -C "$out_abs" add "$staged_file"
append_dogfood_marker "$unstaged_file" "unstaged"

cat >"$out_abs/pickforge-dirty-dogfood-untracked.txt" <<'UNTRACKED'
Pickforge dirty-git dogfood untracked file.
This disposable file should remain untracked after checkpoint creation.
UNTRACKED

status_path="$artifact_abs/status.txt"
instructions_path="$artifact_abs/instructions.txt"

git -C "$out_abs" status --short --branch >"$status_path"

cat >"$instructions_path" <<INSTRUCTIONS
Disposable dirty-git dogfood project prepared.

Source project:
$source_top

Pickforge project root:
$out_abs

Expected checks:
- Pickforge should warn before forging into this dirty worktree.
- The dirty summary should show staged, unstaged, and untracked files.
- The Create checkpoint action should commit tracked changes only.
- pickforge-dirty-dogfood-untracked.txt should remain untracked after checkpoint creation.

Current git status:
$(cat "$status_path")

Cleanup:
git -C "$source_top" worktree remove --force "$out_abs"
INSTRUCTIONS

echo "Dirty-git dogfood project prepared."
echo "Project root: $out_abs"
echo "Status: $status_path"
echo "Instructions: $instructions_path"
