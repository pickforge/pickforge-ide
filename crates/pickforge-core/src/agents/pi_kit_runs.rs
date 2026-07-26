//! Reader for pi-kit's external run status/abandon-request file contract
//! (`<run>.status.json` / `<run>.abandon.json` under the pi-kit runs dir).
//!
//! This module never reads the raw `*.jsonl` journals — those carry
//! unredacted `task`/`cwd`/`rationale` that pi-kit's own status file
//! deliberately strips — and it never signals a lane pid directly.
//! Abandonment goes through the `<run>.abandon.json` request channel the
//! owning pi-kit runner watches and translates into its journaled abandon
//! path. See pi-kit's README, "External status and abandon-request files".

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Schema version this reader understands. A status file reporting a
/// different `schemaVersion` is surfaced as `supported: false` (listed, not
/// dropped, not erred) rather than parsed against a shape it doesn't match.
const SUPPORTED_SCHEMA_VERSION: u64 = 1;

/// Status files are small, hand-sized JSON documents (a run header plus a
/// handful of lane rows, no raw journal text). Anything past this is refused
/// unread rather than fully buffered, mirroring `pi_kit::SHIM_READ_LIMIT_BYTES`.
const STATUS_FILE_READ_LIMIT_BYTES: u64 = 1024 * 1024;

/// How long a run may go without a confirmed-live lane pid *and* without a
/// status-file update before it's flagged orphaned. pi-kit rewrites the
/// status file on every lane update (tool call, usage tick, status text)
/// while a lane is actually working, so gaps under normal operation are
/// seconds, not minutes; this threshold absorbs thinking pauses and
/// filesystem hiccups while still catching an owner that crashed mid-run
/// within roughly one UI session.
const ORPHAN_STALE_MS: i64 = 45_000;

/// Bound on how long an abandon-consumption poll may run, and the interval
/// between checks. pi-kit's runner watches the abandon file with `fs.watch`
/// plus a 1s poll fallback (README), so it should react within ~1s; this
/// budget covers a couple of its poll cycles plus local IPC round trips
/// without blocking the caller indefinitely.
const ABANDON_POLL_TIMEOUT: Duration = Duration::from_secs(3);
const ABANDON_POLL_INTERVAL: Duration = Duration::from_millis(200);

const STATUS_SUFFIX: &str = ".status.json";

/// Env var pi-kit itself reads to relocate its data directory (`journalDir()`
/// in pi-kit's `journal-core.ts`). Mirrored here so PickForge watches the
/// same directory pi-kit actually writes to.
pub const PIKIT_DATA_DIR_ENV: &str = "PIKIT_DATA_DIR";

/// Resolves the root pi-kit data directory the same way pi-kit's own
/// `dataDir()` does (`journal-core.ts`: `process.env[DATA_DIR_ENV] ??
/// join(homedir(), ...)`): a PRESENT `env` value is used verbatim — even
/// empty or whitespace-only, since `??` only falls back on `undefined`, not
/// on an empty string — and only an ABSENT env falls back to
/// `<home>/.pickforge/pi-kit`. Every reader/writer that anchors a path off
/// this root (runs, the forge-context writer) must share this exact rule, or
/// a writer and pi-kit's own reader would resolve different directories
/// under the same `PIKIT_DATA_DIR=""` process. Pure and does not touch the
/// filesystem.
pub fn pi_kit_data_dir(home: &Path, env: Option<&str>) -> PathBuf {
    match env {
        Some(dir) => PathBuf::from(dir),
        None => home.join(".pickforge").join("pi-kit"),
    }
}

/// Resolves the pi-kit runs directory: [`pi_kit_data_dir`] plus the `runs`
/// subdirectory. A missing directory is handled by the reader, not here.
pub fn pi_kit_runs_dir(home: &Path, env: Option<&str>) -> PathBuf {
    pi_kit_data_dir(home, env).join("runs")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiKitLaneStatus {
    pub lane: String,
    pub model: String,
    pub effort: String,
    pub mode: String,
    pub state: String,
    #[serde(default)]
    pub current_tool: Option<String>,
    #[serde(default)]
    pub last_status: Option<String>,
    #[serde(default)]
    pub tokens_in: f64,
    #[serde(default)]
    pub tokens_out: f64,
    #[serde(default)]
    pub cost: f64,
    #[serde(default)]
    pub context: f64,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<f64>,
    #[serde(default)]
    pub abandon_reason: Option<String>,
    /// Present only so a consumer can run an orphan/liveness heuristic.
    /// Never used to signal the process directly — see module docs.
    #[serde(default)]
    pub pid: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiKitRunTotals {
    #[serde(default)]
    pub cost: f64,
    #[serde(default)]
    pub tokens_in: f64,
    #[serde(default)]
    pub tokens_out: f64,
}

/// The parsed `<run>.status.json` contract body (schemaVersion 1). A
/// best-effort, non-authoritative projection of pi-kit's journal — never a
/// second source of truth; see module docs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiKitRunStatus {
    pub schema_version: u64,
    pub revision: u64,
    pub updated_at_ms: i64,
    pub run: String,
    /// `"active" | "ended"`.
    pub state: String,
    #[serde(default)]
    pub ok: Option<bool>,
    #[serde(default)]
    pub duration_ms: f64,
    pub totals: PiKitRunTotals,
    #[serde(default)]
    pub lanes: Vec<PiKitLaneStatus>,
}

/// One run as PickForge sees it: the parsed status (when the schema version
/// is supported and the file wasn't caught mid-write) plus the derived
/// orphan verdict. `run` and `supported` are always populated so an
/// unsupported-schema file still identifies itself in a listing.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiKitRunEntry {
    pub run: String,
    pub supported: bool,
    pub status: Option<PiKitRunStatus>,
    pub orphaned: bool,
}

/// One page of runs plus the total on disk, so the panel can bound what it
/// renders without lying about how much history exists (#363).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiKitRunPage {
    pub runs: Vec<PiKitRunEntry>,
    /// Every `*.status.json` on disk, including ones this page omits.
    pub total: usize,
}

/// Lists every `<run>.status.json` in `runs_dir`, newest run id first (run
/// ids embed a compact timestamp, so a reverse lexical sort mirrors pi-kit's
/// own `listRuns()`). A missing runs directory is the neutral "no runs yet"
/// result — never an error, matching the `pi_kit::detect_pi_kit` idiom for a
/// probe over a directory the counterpart process may not have created yet.
/// A torn or malformed file (caught mid tmp+rename, or predating this
/// contract) is silently omitted for this call — the same swallow-and-retry
/// tolerance pi-kit's own write path documents, since the next poll picks up
/// the next revision.
pub fn list_pi_kit_runs(runs_dir: &Path) -> Vec<PiKitRunEntry> {
    list_pi_kit_runs_at(runs_dir, now_ms())
}

/// Bounded listing: **every active run**, plus the `limit` most recent ended
/// ones, plus the total on disk.
///
/// Not simply "the newest N". Run ids embed a start timestamp, so a
/// long-running active run sorts below newer *ended* ones — a strict newest-N
/// page would hide exactly the runs still worth acting on. Active runs are
/// therefore never dropped, and the cap applies only to history (#363).
///
/// `limit == 0` still returns every active run: the cap bounds history, it does
/// not suppress live work.
pub fn list_pi_kit_run_page(runs_dir: &Path, limit: usize) -> PiKitRunPage {
    list_pi_kit_run_page_at(runs_dir, limit, now_ms())
}

fn list_pi_kit_run_page_at(runs_dir: &Path, limit: usize, now_ms: i64) -> PiKitRunPage {
    let all = list_pi_kit_runs_at(runs_dir, now_ms);
    let total = all.len();
    let mut ended_kept = 0usize;
    let runs = all
        .into_iter()
        .filter(|entry| {
            if is_active_entry(entry) {
                return true;
            }
            ended_kept += 1;
            ended_kept <= limit
        })
        .collect();
    PiKitRunPage { runs, total }
}

/// A run counts as active while its status says so. An unreadable or
/// unsupported status cannot be shown to be finished, so it is treated as
/// history rather than pinned forever.
fn is_active_entry(entry: &PiKitRunEntry) -> bool {
    entry
        .status
        .as_ref()
        .map(|status| status.state == "active")
        .unwrap_or(false)
}

/// Deterministic core of [`list_pi_kit_runs`] with an injected clock, so
/// orphan staleness is testable without real sleeps.
fn list_pi_kit_runs_at(runs_dir: &Path, now_ms: i64) -> Vec<PiKitRunEntry> {
    let Ok(entries) = std::fs::read_dir(runs_dir) else {
        return Vec::new();
    };
    let mut file_names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.ends_with(STATUS_SUFFIX))
        .collect();
    file_names.sort();
    file_names.reverse();
    file_names
        .into_iter()
        .filter_map(|name| read_status_entry(&runs_dir.join(name), now_ms))
        .collect()
}

fn read_status_entry(path: &Path, now_ms: i64) -> Option<PiKitRunEntry> {
    let file_name = path.file_name()?.to_str()?;
    let run_from_name = file_name.strip_suffix(STATUS_SUFFIX)?.to_string();

    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > STATUS_FILE_READ_LIMIT_BYTES {
        return None;
    }
    let contents = std::fs::read_to_string(path).ok()?;
    let raw: serde_json::Value = serde_json::from_str(&contents).ok()?;

    match raw.get("schemaVersion").and_then(serde_json::Value::as_u64) {
        Some(SUPPORTED_SCHEMA_VERSION) => {
            let status = serde_json::from_value::<PiKitRunStatus>(raw).ok()?;
            let orphaned = is_orphaned(&status, now_ms);
            Some(PiKitRunEntry {
                run: status.run.clone(),
                supported: true,
                status: Some(status),
                orphaned,
            })
        }
        Some(_unsupported) => {
            let run = raw
                .get("run")
                .and_then(serde_json::Value::as_str)
                .map_or(run_from_name, str::to_string);
            Some(PiKitRunEntry { run, supported: false, status: None, orphaned: false })
        }
        None => None,
    }
}

/// A run is orphaned when it hasn't ended and its owner looks gone: either a
/// pid-liveness probe confirms no lane process survives, or (when liveness
/// can't be checked at all) the status file has gone stale past
/// [`ORPHAN_STALE_MS`]. A pid confirmed alive always wins over staleness —
/// the status file is best-effort and can lag a genuinely live, working
/// owner, so a live process must never be reported orphaned.
fn is_orphaned(status: &PiKitRunStatus, now_ms: i64) -> bool {
    if status.state == "ended" {
        return false;
    }
    match lane_liveness(&status.lanes) {
        Some(true) => false,
        Some(false) => true,
        None => now_ms.saturating_sub(status.updated_at_ms) > ORPHAN_STALE_MS,
    }
}

/// `Some(true)` if any *running* lane's pid is confirmed alive, `Some(false)`
/// if at least one running-lane pid was present and every one is confirmed
/// dead, `None` when no liveness signal is available — the staleness
/// fallback in [`is_orphaned`] then applies.
///
/// Only `state == "running"` lane pids count. pi-kit keeps a lane's pid in
/// the snapshot after `lane_end` (it's the last pid that lane ever had, not
/// a live one), so between waves — one lane just finished, its process
/// already exited, and the next lane hasn't started yet — every *present*
/// pid can be dead while the run and its runner are both perfectly alive.
/// Restricting the probe to running lanes avoids reading that as "no lane
/// pid alive" and misreporting a healthy in-between-waves run as orphaned.
fn lane_liveness(lanes: &[PiKitLaneStatus]) -> Option<bool> {
    let pids: Vec<i32> = lanes
        .iter()
        .filter(|lane| lane.state == "running")
        .filter_map(|lane| lane.pid)
        .collect();
    if pids.is_empty() {
        return None;
    }
    #[cfg(unix)]
    {
        Some(pids.iter().any(|&pid| pid_alive(pid)))
    }
    #[cfg(not(unix))]
    {
        // Windows honest-degrade: no pid-liveness probe wired up, so a
        // present pid carries no signal here — staleness alone decides.
        let _ = pids;
        None
    }
}

#[cfg(unix)]
fn pid_alive(pid: i32) -> bool {
    pid > 0 && unsafe { libc::kill(pid, 0) == 0 }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AbandonRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    lane: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

/// Whether the abandon-request file was written and, best-effort, whether
/// the owning runner appeared to consume it within the poll budget.
/// `consumed: false` is not necessarily a failure — the runner may still be
/// mid-poll past this call's bounded window, or run_end/abandonAll may not
/// have yet advanced the targeted lane's own state.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiKitAbandonOutcome {
    pub requested: bool,
    pub consumed: bool,
}

/// Writes `<run>.abandon.json` atomically (tmp file + rename, per the
/// contract's producer recommendation) and then polls the run's status file
/// briefly for evidence the owning runner consumed it — never signals the
/// lane pid directly. `lane` omitted abandons every active lane in the run.
pub fn abandon_pi_kit_lane(
    runs_dir: &Path,
    run: &str,
    lane: Option<&str>,
    reason: Option<&str>,
) -> std::io::Result<PiKitAbandonOutcome> {
    write_abandon_request(runs_dir, run, lane, reason)?;
    let consumed = poll_for_abandon_consumed(runs_dir, run, lane);
    Ok(PiKitAbandonOutcome { requested: true, consumed })
}

/// pi-kit run ids look like `run-`compact-timestamp-`-`hex (ASCII
/// alphanumerics and `-` only). `run` is joined straight into a filesystem
/// path below, and it can arrive here from IPC or a parsed status file
/// rather than a value this process minted itself — so anything outside
/// that strict allowlist (separators, `.` for `..`-style traversal, anything
/// non-ASCII) is rejected before any path is built. This is deliberately
/// stricter than pi-kit's own lane-id shape (see
/// `is_valid_pi_kit_lane_name`): only the run id ever touches a path here.
fn is_valid_pi_kit_run_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// pi-kit's own lane-id shape (`table.ts`'s `LANE_ID_PATTERN`:
/// `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) — first character ASCII
/// alphanumeric, then up to 63 more ASCII alphanumerics, `.`, `_`, or `-`.
/// `lane` never touches a filesystem path (it's written verbatim into the
/// abandon-request body), so it's checked against pi-kit's real allowlist
/// rather than the stricter path-safe one `run` needs — a caller-chosen name
/// like `"my_lane"` or `"scout.v2"` is valid pi-kit input and must not be
/// rejected here.
fn is_valid_pi_kit_lane_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else { return false };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    let rest: Vec<char> = chars.collect();
    rest.len() <= 63 && rest.iter().all(|&c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn invalid_id_error(kind: &str, id: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("invalid pi-kit {kind}: {id:?}"))
}

fn write_abandon_request(
    runs_dir: &Path,
    run: &str,
    lane: Option<&str>,
    reason: Option<&str>,
) -> std::io::Result<()> {
    if !is_valid_pi_kit_run_id(run) {
        return Err(invalid_id_error("run id", run));
    }
    if let Some(name) = lane {
        if !is_valid_pi_kit_lane_name(name) {
            return Err(invalid_id_error("lane name", name));
        }
    }
    std::fs::create_dir_all(runs_dir)?;
    let body = serde_json::to_string(&AbandonRequest { lane, reason })
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    let tmp_path = runs_dir.join(format!("{run}.abandon.json.tmp"));
    let final_path = runs_dir.join(format!("{run}.abandon.json"));
    std::fs::write(&tmp_path, body)?;
    std::fs::rename(&tmp_path, &final_path)
}

fn poll_for_abandon_consumed(runs_dir: &Path, run: &str, lane: Option<&str>) -> bool {
    let status_path = runs_dir.join(format!("{run}{STATUS_SUFFIX}"));
    let deadline = Instant::now() + ABANDON_POLL_TIMEOUT;
    loop {
        if let Some(entry) = read_status_entry(&status_path, now_ms()) {
            if entry.status.as_ref().is_some_and(|status| lane_abandoned(status, lane)) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(ABANDON_POLL_INTERVAL);
    }
}

/// True once the journaled outcome of an abandon request is visible in the
/// status file: the named lane reached `"abandoned"`, or — for an
/// all-lanes request (`lane: None`) — every lane in the run has settled into
/// a terminal state.
fn lane_abandoned(status: &PiKitRunStatus, lane: Option<&str>) -> bool {
    match lane {
        Some(name) => status
            .lanes
            .iter()
            .any(|candidate| candidate.lane == name && candidate.state == "abandoned"),
        None => {
            !status.lanes.is_empty()
                && status
                    .lanes
                    .iter()
                    .all(|candidate| matches!(candidate.state.as_str(), "abandoned" | "done" | "failed"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir()
                .join(format!("pickforge-pi-kit-runs-{name}-{}-{stamp}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn write(&self, relative: &str, text: &str) {
            std::fs::write(self.path.join(relative), text).unwrap();
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn lane_json(lane: &str, state: &str, pid: Option<i32>) -> String {
        let pid_field = pid.map_or_else(String::new, |p| format!(r#","pid":{p}"#));
        format!(
            r#"{{"lane":"{lane}","model":"openai-codex/gpt-5.6-sol","effort":"medium","mode":"read-only","state":"{state}","tokensIn":100,"tokensOut":50,"cost":0.02,"context":1200{pid_field}}}"#
        )
    }

    fn status_json(run: &str, state: &str, updated_at_ms: i64, lanes: &[String]) -> String {
        format!(
            r#"{{"schemaVersion":1,"revision":3,"updatedAtMs":{updated_at_ms},"run":"{run}","state":"{state}","durationMs":1000,"totals":{{"cost":0.02,"tokensIn":100,"tokensOut":50}},"lanes":[{}]}}"#,
            lanes.join(",")
        )
    }

    /// Run ids sort lexically, and the listing is newest-first, so `run-9xxx`
    /// is "newer" than `run-1xxx`.
    fn seed_page_fixture(root: &TempDir) {
        let live_pid = std::process::id() as i32;
        let running = [lane_json("lane-1", "running", Some(live_pid))];
        let done = [lane_json("lane-1", "done", Some(i32::MAX))];
        // One OLD active run — the case a strict newest-N page would hide.
        root.write("run-1000.status.json", &status_json("run-1000", "active", now_ms(), &running));
        for id in ["run-2000", "run-3000", "run-4000", "run-5000", "run-6000"] {
            root.write(&format!("{id}.status.json"), &status_json(id, "ended", now_ms(), &done));
        }
    }

    #[test]
    fn page_keeps_every_active_run_even_when_older_than_the_cap() {
        let root = TempDir::new("page-active");
        seed_page_fixture(&root);

        let page = list_pi_kit_run_page(&root.path, 2);

        assert_eq!(page.total, 6);
        // 2 newest ended + the old active one, which is NOT counted against
        // the cap and NOT dropped for being old.
        let ids: Vec<&str> = page.runs.iter().map(|entry| entry.run.as_str()).collect();
        assert_eq!(ids, vec!["run-6000", "run-5000", "run-1000"]);
    }

    #[test]
    fn page_reports_the_full_total_even_when_it_omits_runs() {
        let root = TempDir::new("page-total");
        seed_page_fixture(&root);

        let page = list_pi_kit_run_page(&root.path, 1);

        assert_eq!(page.runs.len(), 2); // 1 ended + 1 active
        assert_eq!(page.total, 6);
    }

    #[test]
    fn a_zero_limit_still_returns_live_work() {
        // The cap bounds history; it must never suppress a run you can still act on.
        let root = TempDir::new("page-zero");
        seed_page_fixture(&root);

        let page = list_pi_kit_run_page(&root.path, 0);

        assert_eq!(page.runs.len(), 1);
        assert_eq!(page.runs[0].run, "run-1000");
        assert_eq!(page.total, 6);
    }

    #[test]
    fn a_limit_beyond_history_returns_everything() {
        let root = TempDir::new("page-big");
        seed_page_fixture(&root);

        let page = list_pi_kit_run_page(&root.path, 100);

        assert_eq!(page.runs.len(), 6);
        assert_eq!(page.total, 6);
    }

    #[test]
    fn an_unreadable_status_counts_as_history_not_pinned_live() {
        // A run whose status cannot be parsed cannot be shown to be finished —
        // but pinning it forever would let junk crowd out real runs.
        let root = TempDir::new("page-unsupported");
        root.write("run-9000.status.json", r#"{"schemaVersion":99,"run":"run-9000"}"#);
        let done = [lane_json("lane-1", "done", Some(i32::MAX))];
        root.write("run-8000.status.json", &status_json("run-8000", "ended", now_ms(), &done));

        let page = list_pi_kit_run_page(&root.path, 1);

        assert_eq!(page.total, 2);
        assert_eq!(page.runs.len(), 1);
        assert_eq!(page.runs[0].run, "run-9000"); // newest-first, capped at 1
    }

    #[test]
    fn missing_runs_dir_is_neutral_empty_list() {
        let root = TempDir::new("missing");
        let runs = list_pi_kit_runs(&root.path.join("nope"));
        assert!(runs.is_empty());
    }

    #[test]
    fn active_run_with_live_pid_is_not_orphaned() {
        let root = TempDir::new("active");
        let live_pid = std::process::id() as i32;
        let lanes = [lane_json("lane-1", "running", Some(live_pid))];
        root.write("run-active.status.json", &status_json("run-active", "active", now_ms(), &lanes));

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.len(), 1);
        assert!(runs[0].supported);
        assert!(!runs[0].orphaned);
        assert_eq!(runs[0].status.as_ref().unwrap().state, "active");
    }

    #[test]
    fn ended_run_is_never_orphaned_even_with_dead_pid_and_stale_timestamp() {
        let root = TempDir::new("ended");
        // `state: "ended"` short-circuits before any liveness probe, so this
        // just needs *a* pid value, not a verifiably dead one.
        let unreachable_pid = i32::MAX;
        let lanes = [lane_json("lane-1", "done", Some(unreachable_pid))];
        let ancient = now_ms() - (ORPHAN_STALE_MS * 10);
        root.write("run-ended.status.json", &status_json("run-ended", "ended", ancient, &lanes));

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.len(), 1);
        assert!(!runs[0].orphaned);
    }

    #[cfg(unix)]
    #[test]
    fn orphaned_by_dead_pid_regardless_of_freshness() {
        let root = TempDir::new("dead-pid");
        let dead_pid = dead_pid();
        let lanes = [lane_json("lane-1", "running", Some(dead_pid))];
        // Freshly updated, but the only known lane pid is confirmed dead.
        root.write("run-dead.status.json", &status_json("run-dead", "active", now_ms(), &lanes));

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.len(), 1);
        assert!(runs[0].orphaned);
    }

    #[test]
    fn orphaned_by_staleness_when_no_pid_signal_is_available() {
        let root = TempDir::new("stale");
        let lanes = [lane_json("lane-1", "running", None)];
        let stale = now_ms() - (ORPHAN_STALE_MS + 5_000);
        root.write("run-stale.status.json", &status_json("run-stale", "active", stale, &lanes));

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.len(), 1);
        assert!(runs[0].orphaned);
    }

    #[test]
    fn fresh_run_with_no_pid_signal_is_not_orphaned() {
        let root = TempDir::new("fresh-no-pid");
        let lanes = [lane_json("lane-1", "queued", None)];
        root.write("run-fresh.status.json", &status_json("run-fresh", "active", now_ms(), &lanes));

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.len(), 1);
        assert!(!runs[0].orphaned);
    }

    #[cfg(unix)]
    #[test]
    fn dead_pid_on_a_finished_lane_does_not_orphan_a_fresh_between_waves_run() {
        let root = TempDir::new("between-waves");
        let dead_pid = dead_pid();
        // A lane that already finished keeps its last (now-dead) pid in the
        // snapshot; a queued lane has none yet. Neither is "running", so
        // neither should count against liveness — only staleness should.
        let lanes = [
            lane_json("lane-1", "done", Some(dead_pid)),
            lane_json("lane-2", "queued", None),
        ];
        root.write(
            "run-between-waves.status.json",
            &status_json("run-between-waves", "active", now_ms(), &lanes),
        );

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.len(), 1);
        assert!(!runs[0].orphaned);
    }

    #[test]
    fn unsupported_schema_version_is_listed_but_not_parsed() {
        let root = TempDir::new("unsupported");
        root.write(
            "run-future.status.json",
            r#"{"schemaVersion":2,"run":"run-future","state":"active"}"#,
        );

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.len(), 1);
        assert!(!runs[0].supported);
        assert!(runs[0].status.is_none());
        assert!(!runs[0].orphaned);
        assert_eq!(runs[0].run, "run-future");
    }

    #[test]
    fn missing_schema_version_is_treated_as_torn_and_omitted() {
        let root = TempDir::new("no-schema");
        root.write("run-pre.status.json", r#"{"run":"run-pre","state":"active"}"#);

        let runs = list_pi_kit_runs(&root.path);

        assert!(runs.is_empty());
    }

    #[test]
    fn torn_json_is_omitted_not_erred() {
        let root = TempDir::new("torn");
        root.write("run-torn.status.json", r#"{"schemaVersion":1,"run":"run-torn","sta"#);

        let runs = list_pi_kit_runs(&root.path);

        assert!(runs.is_empty());
    }

    #[test]
    fn oversized_status_file_is_refused_unread() {
        let root = TempDir::new("oversized");
        let padding = "x".repeat((STATUS_FILE_READ_LIMIT_BYTES as usize) + 100);
        root.write(
            "run-huge.status.json",
            &format!(r#"{{"schemaVersion":1,"run":"run-huge","state":"active","pad":"{padding}"}}"#),
        );

        let runs = list_pi_kit_runs(&root.path);

        assert!(runs.is_empty());
    }

    #[test]
    fn newest_run_lists_first() {
        let root = TempDir::new("order");
        let lanes = [lane_json("lane-1", "done", None)];
        root.write("run-20260101-0001.status.json", &status_json("run-20260101-0001", "ended", 1, &lanes));
        root.write("run-20260201-0002.status.json", &status_json("run-20260201-0002", "ended", 2, &lanes));

        let runs = list_pi_kit_runs(&root.path);

        assert_eq!(runs.iter().map(|r| r.run.as_str()).collect::<Vec<_>>(), vec![
            "run-20260201-0002",
            "run-20260101-0001",
        ]);
    }

    #[test]
    fn pi_kit_runs_dir_prefers_env_override_over_home_default() {
        let home = Path::new("/home/user");
        assert_eq!(
            pi_kit_runs_dir(home, Some("/custom/data")),
            PathBuf::from("/custom/data/runs"),
        );
        assert_eq!(
            pi_kit_runs_dir(home, None),
            PathBuf::from("/home/user/.pickforge/pi-kit/runs"),
        );
    }

    /// Pins parity with pi-kit's own `dataDir()` (`process.env[VAR] ??
    /// fallback`): a PRESENT env value is used verbatim, even when blank —
    /// only an ABSENT env falls back to the home default. A writer that
    /// instead special-cased blank envs as "unset" would resolve a different
    /// directory than pi-kit's reader under the same `PIKIT_DATA_DIR=""`.
    #[test]
    fn pi_kit_runs_dir_uses_a_present_blank_env_verbatim_never_falling_back() {
        let home = Path::new("/home/user");
        assert_eq!(pi_kit_runs_dir(home, Some("")), PathBuf::from("runs"));
        assert_eq!(pi_kit_runs_dir(home, Some("  ")), PathBuf::from("  /runs"));
    }

    #[test]
    fn pi_kit_data_dir_prefers_env_override_over_home_default() {
        let home = Path::new("/home/user");
        assert_eq!(pi_kit_data_dir(home, Some("/custom/data")), PathBuf::from("/custom/data"));
        assert_eq!(pi_kit_data_dir(home, None), PathBuf::from("/home/user/.pickforge/pi-kit"));
    }

    /// Same parity rule as [`pi_kit_runs_dir_uses_a_present_blank_env_verbatim_never_falling_back`],
    /// pinned directly on `pi_kit_data_dir` since it's the function that
    /// actually implements the env resolution both readers/writers share.
    #[test]
    fn pi_kit_data_dir_uses_a_present_blank_env_verbatim_never_falling_back() {
        let home = Path::new("/home/user");
        assert_eq!(pi_kit_data_dir(home, Some("")), PathBuf::from(""));
        assert_eq!(pi_kit_data_dir(home, Some("  ")), PathBuf::from("  "));
    }

    #[test]
    fn write_abandon_request_is_atomic_tmp_then_rename() {
        let root = TempDir::new("abandon-write");
        write_abandon_request(&root.path, "run-1", Some("lane-1"), Some("user requested")).unwrap();

        let written = std::fs::read_to_string(root.path.join("run-1.abandon.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(parsed["lane"], "lane-1");
        assert_eq!(parsed["reason"], "user requested");
        assert!(!root.path.join("run-1.abandon.json.tmp").exists());
    }

    #[test]
    fn write_abandon_request_omits_absent_fields() {
        let root = TempDir::new("abandon-write-all");
        write_abandon_request(&root.path, "run-1", None, None).unwrap();

        let written = std::fs::read_to_string(root.path.join("run-1.abandon.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert!(parsed.get("lane").is_none());
        assert!(parsed.get("reason").is_none());
    }

    #[test]
    fn is_valid_pi_kit_run_id_allows_pi_kit_shaped_run_ids_and_rejects_everything_else() {
        assert!(is_valid_pi_kit_run_id("run-20260101000000-ab12"));
        assert!(is_valid_pi_kit_run_id("lane-1"));
        assert!(is_valid_pi_kit_run_id("RUN123"));

        assert!(!is_valid_pi_kit_run_id(""));
        assert!(!is_valid_pi_kit_run_id(".."));
        assert!(!is_valid_pi_kit_run_id("../evil"));
        assert!(!is_valid_pi_kit_run_id("a/b"));
        assert!(!is_valid_pi_kit_run_id("a\\b"));
        assert!(!is_valid_pi_kit_run_id("a.b"));
        assert!(!is_valid_pi_kit_run_id("a b"));
        assert!(!is_valid_pi_kit_run_id("a$b"));
        // The run id stays on the strict path-safe allowlist even though
        // pi-kit's own lane pattern would accept these.
        assert!(!is_valid_pi_kit_run_id("my_run"));
        assert!(!is_valid_pi_kit_run_id("run.v2"));
    }

    #[test]
    fn is_valid_pi_kit_lane_name_accepts_pi_kits_own_lane_id_shapes() {
        // pi-kit's table.ts LANE_ID_PATTERN: ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
        assert!(is_valid_pi_kit_lane_name("lane-1"));
        assert!(is_valid_pi_kit_lane_name("my_lane"));
        assert!(is_valid_pi_kit_lane_name("scout.v2"));
        assert!(is_valid_pi_kit_lane_name("A1"));
        assert!(is_valid_pi_kit_lane_name(&"a".repeat(64)));
    }

    #[test]
    fn is_valid_pi_kit_lane_name_rejects_shapes_pi_kit_itself_would_reject() {
        assert!(!is_valid_pi_kit_lane_name(""));
        assert!(!is_valid_pi_kit_lane_name("_lane"));
        assert!(!is_valid_pi_kit_lane_name(".lane"));
        assert!(!is_valid_pi_kit_lane_name("-lane"));
        assert!(!is_valid_pi_kit_lane_name(&"a".repeat(65)));
    }

    #[test]
    fn is_valid_pi_kit_lane_name_rejects_path_traversal_and_separators() {
        // Lane names never touch a path, but the request body is still no
        // place for these.
        assert!(!is_valid_pi_kit_lane_name(".."));
        assert!(!is_valid_pi_kit_lane_name("../evil"));
        assert!(!is_valid_pi_kit_lane_name("a/b"));
        assert!(!is_valid_pi_kit_lane_name("a\\b"));
        assert!(!is_valid_pi_kit_lane_name("a b"));
        assert!(!is_valid_pi_kit_lane_name("a$b"));
    }

    #[test]
    fn write_abandon_request_rejects_a_traversal_run_id_without_touching_the_filesystem() {
        let root = TempDir::new("abandon-traversal-run");

        let result = write_abandon_request(&root.path, "../evil", None, None);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::InvalidInput);
        assert_eq!(std::fs::read_dir(&root.path).unwrap().count(), 0);
        let escaped = root.path.parent().unwrap().join("evil.abandon.json");
        assert!(!escaped.exists());
    }

    #[test]
    fn write_abandon_request_rejects_a_traversal_lane_name_without_touching_the_filesystem() {
        let root = TempDir::new("abandon-traversal-lane");

        let result = write_abandon_request(&root.path, "run-1", Some("../evil"), None);

        assert!(result.is_err());
        assert_eq!(std::fs::read_dir(&root.path).unwrap().count(), 0);
    }

    #[test]
    fn write_abandon_request_accepts_pi_kit_shaped_lane_names_with_dot_and_underscore() {
        let root = TempDir::new("abandon-lane-shapes");

        write_abandon_request(&root.path, "run-1", Some("my_lane"), None).unwrap();
        write_abandon_request(&root.path, "run-1", Some("scout.v2"), None).unwrap();

        let written = std::fs::read_to_string(root.path.join("run-1.abandon.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(parsed["lane"], "scout.v2");
    }

    #[test]
    fn write_abandon_request_still_rejects_a_pi_kit_shaped_lane_name_as_a_run_id() {
        let root = TempDir::new("abandon-run-shape-mismatch");

        let underscore = write_abandon_request(&root.path, "my_run", None, None);
        let dotted = write_abandon_request(&root.path, "run.v2", None, None);

        assert!(underscore.is_err());
        assert!(dotted.is_err());
        assert_eq!(std::fs::read_dir(&root.path).unwrap().count(), 0);
    }

    #[test]
    fn abandon_pi_kit_lane_rejects_a_traversal_run_id_before_writing_or_polling() {
        let root = TempDir::new("abandon-lane-traversal");

        let result = abandon_pi_kit_lane(&root.path, "../evil", None, None);

        assert!(result.is_err());
        assert_eq!(std::fs::read_dir(&root.path).unwrap().count(), 0);
    }

    #[test]
    fn abandon_pi_kit_lane_reports_consumed_once_status_shows_the_lane_abandoned() {
        let root = TempDir::new("abandon-consumed");
        let lanes = [lane_json("lane-1", "running", Some(std::process::id() as i32))];
        root.write("run-1.status.json", &status_json("run-1", "active", now_ms(), &lanes));

        // Simulate the owning runner consuming the request shortly after.
        let status_path = root.path.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            let abandoned = [lane_json("lane-1", "abandoned", Some(std::process::id() as i32))];
            std::fs::write(
                status_path.join("run-1.status.json"),
                status_json("run-1", "active", now_ms(), &abandoned),
            )
            .unwrap();
        });

        let outcome = abandon_pi_kit_lane(&root.path, "run-1", Some("lane-1"), Some("user requested")).unwrap();
        handle.join().unwrap();

        assert!(outcome.requested);
        assert!(outcome.consumed);
    }

    #[test]
    fn abandon_pi_kit_lane_reports_not_consumed_when_status_never_updates() {
        let root = TempDir::new("abandon-not-consumed");
        let lanes = [lane_json("lane-1", "running", Some(std::process::id() as i32))];
        root.write("run-1.status.json", &status_json("run-1", "active", now_ms(), &lanes));

        let outcome = abandon_pi_kit_lane(&root.path, "run-1", Some("lane-1"), None).unwrap();

        assert!(outcome.requested);
        assert!(!outcome.consumed);
        let written = std::fs::read_to_string(root.path.join("run-1.abandon.json")).unwrap();
        assert!(written.contains("lane-1"));
    }

    /// Spawns a process, waits for it to exit, and returns its (now-reused-risk
    /// but practically dead) pid — mirrors the dead-pid fixture idiom already
    /// used across this crate's process-liveness tests (e.g. `ios_commands.rs`).
    #[cfg(unix)]
    fn dead_pid() -> i32 {
        let mut child = std::process::Command::new("true").spawn().expect("spawn true");
        let pid = child.id() as i32;
        child.wait().expect("wait for true");
        pid
    }
}
