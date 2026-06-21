//! SQLite store (rusqlite, bundled) — replaces Drift. One connection behind a
//! Mutex, serving the projects/chats/settings/history/run-log DAOs the UI needs.
//! Schema mirrors the final Drift v10 state in `lib/core/drift/`.

mod models;

pub use models::{AgentRunLog, Chat, PickHistory, Project, ProjectSettings, RunSessionLog};

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, Row};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Other(String),
}

/// Drift's final `PRAGMA user_version`. The previous Flutter/Drift app managed
/// its own schema with `user_version` 1..=10; a real upgrading user's database
/// sits anywhere in that range.
const DRIFT_FINAL: u32 = 10;

/// First Rust-managed schema version. Deliberately set above Drift's range so a
/// Rust-stamped database can never be confused with a Drift-era one.
const RUST_BASELINE: u32 = 11;

/// Latest schema version this build understands. Bump (and add a numbered Rust
/// migration in `apply_rust_migrations`) whenever the schema changes from here.
const LATEST_VERSION: u32 = 11;

/// The full, current desired schema. Every statement is `IF NOT EXISTS`, so
/// running it against a database that already holds some tables only fills the
/// gaps. Column-level evolution that `CREATE TABLE IF NOT EXISTS` cannot express
/// (a table that already exists but lacks a newer column) is handled by the
/// `ALTER TABLE … ADD COLUMN` pass in `reconcile_schema`.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
  project_root   TEXT NOT NULL PRIMARY KEY,
  display_name   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  archived_at    INTEGER
);

CREATE TABLE IF NOT EXISTS chats (
  chat_id          TEXT NOT NULL PRIMARY KEY,
  project_root     TEXT NOT NULL REFERENCES projects(project_root) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  skill_id         TEXT,
  session_id       TEXT,
  labels_json      TEXT,
  status           TEXT,
  task_brief_text  TEXT,
  created_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_settings (
  project_root                TEXT NOT NULL PRIMARY KEY,
  vm_service_url              TEXT,
  default_agent_id            TEXT,
  last_chat_id                TEXT,
  pane_sizes                  TEXT,
  last_used_at                INTEGER,
  avd_id                      TEXT,
  avd_name                    TEXT,
  connection_mode             TEXT NOT NULL DEFAULT 'auto',
  flutter_run_args            TEXT,
  target_file                 TEXT,
  validator_command           TEXT,
  emulator_launch_options     TEXT,
  emulator_idle_shutdown      TEXT,
  auto_boot_on_select         INTEGER NOT NULL DEFAULT 1 CHECK (auto_boot_on_select IN (0, 1)),
  first_run_celebrated        INTEGER NOT NULL DEFAULT 0 CHECK (first_run_celebrated IN (0, 1)),
  context_storage_mode        TEXT,
  context_storage_custom_path TEXT
);

CREATE TABLE IF NOT EXISTS pick_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root        TEXT NOT NULL,
  widget_class        TEXT NOT NULL,
  creation_file       TEXT,
  creation_line       INTEGER,
  skill_id            TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  terminal_id         TEXT NOT NULL,
  chat_id             TEXT,
  picked_at           INTEGER NOT NULL,
  widget_context_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_session_log (
  session_id        TEXT NOT NULL PRIMARY KEY,
  project_root      TEXT NOT NULL,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  avd_id            TEXT,
  avd_name          TEXT,
  serial            TEXT,
  vm_service_url    TEXT,
  target_file       TEXT,
  connection_mode   TEXT NOT NULL,
  exit_reason       TEXT,
  exit_code         INTEGER,
  hot_reload_count  INTEGER NOT NULL DEFAULT 0,
  hot_restart_count INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_session_log_project_started
  ON run_session_log(project_root, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  pick_id             INTEGER NOT NULL,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER,
  exit_code           INTEGER,
  hot_reload_count    INTEGER NOT NULL DEFAULT 0,
  wrapper_script_path TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_project
  ON chats(project_root, sort_order ASC, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_pick_history_project
  ON pick_history(project_root, picked_at DESC);
"#;

/// Connection-level pragmas. Applied on every open (they are not persisted with
/// the schema) and never inside a migration transaction.
fn apply_pragmas(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    Ok(())
}

/// True when `table` has a column named `column`.
fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, DbError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Columns the desired schema carries that an older database (a Drift-era one,
/// or an early unversioned Rust one) might be missing. Every entry is either
/// nullable or has a DEFAULT, so `ALTER TABLE … ADD COLUMN` can add it without
/// rewriting existing rows. The Drift version that introduced each column (per
/// the old app's `onUpgrade`) is noted so it is clear which legacy databases
/// could lack it. `reconcile_schema` only runs an ALTER when `has_column` is
/// false, so re-adding a column a database already holds is a silent no-op.
const RECONCILABLE_COLUMNS: &[(&str, &str, &str)] = &[
    // project_settings — the most-evolved table across Drift v2..v10.
    ("project_settings", "last_chat_id", "ALTER TABLE project_settings ADD COLUMN last_chat_id TEXT"), // Drift v2
    ("project_settings", "pane_sizes", "ALTER TABLE project_settings ADD COLUMN pane_sizes TEXT"), // Drift v2
    ("project_settings", "avd_id", "ALTER TABLE project_settings ADD COLUMN avd_id TEXT"), // Drift v3
    ("project_settings", "avd_name", "ALTER TABLE project_settings ADD COLUMN avd_name TEXT"), // Drift v3
    ("project_settings", "connection_mode", "ALTER TABLE project_settings ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'auto'"), // Drift v3
    ("project_settings", "flutter_run_args", "ALTER TABLE project_settings ADD COLUMN flutter_run_args TEXT"), // Drift v3
    ("project_settings", "target_file", "ALTER TABLE project_settings ADD COLUMN target_file TEXT"), // Drift v3
    ("project_settings", "auto_boot_on_select", "ALTER TABLE project_settings ADD COLUMN auto_boot_on_select INTEGER NOT NULL DEFAULT 1"), // Drift v3
    ("project_settings", "first_run_celebrated", "ALTER TABLE project_settings ADD COLUMN first_run_celebrated INTEGER NOT NULL DEFAULT 0"), // Drift v3
    ("project_settings", "emulator_launch_options", "ALTER TABLE project_settings ADD COLUMN emulator_launch_options TEXT"), // Drift v5
    ("project_settings", "emulator_idle_shutdown", "ALTER TABLE project_settings ADD COLUMN emulator_idle_shutdown TEXT"), // Drift v6
    ("project_settings", "validator_command", "ALTER TABLE project_settings ADD COLUMN validator_command TEXT"), // Drift v8
    ("project_settings", "context_storage_mode", "ALTER TABLE project_settings ADD COLUMN context_storage_mode TEXT"), // Drift v10
    ("project_settings", "context_storage_custom_path", "ALTER TABLE project_settings ADD COLUMN context_storage_custom_path TEXT"), // Drift v10
    // chats — labels/status/brief arrived together.
    ("chats", "labels_json", "ALTER TABLE chats ADD COLUMN labels_json TEXT"), // Drift v7
    ("chats", "status", "ALTER TABLE chats ADD COLUMN status TEXT"), // Drift v7
    ("chats", "task_brief_text", "ALTER TABLE chats ADD COLUMN task_brief_text TEXT"), // Drift v7
    // projects — archived_at backfilled for databases that came through v2.
    ("projects", "archived_at", "ALTER TABLE projects ADD COLUMN archived_at INTEGER"), // Drift v9
    // run_session_log — target_file added a version after the table itself.
    ("run_session_log", "target_file", "ALTER TABLE run_session_log ADD COLUMN target_file TEXT"), // Drift v4
];

/// Idempotently bring any pre-Rust database (Drift v1..=10, or an unversioned
/// Rust database created by an earlier `CREATE TABLE IF NOT EXISTS` build) up to
/// the full current schema. Adds missing tables/indexes via `SCHEMA`, then adds
/// any missing columns from `RECONCILABLE_COLUMNS`. Only ever ADDS — never drops
/// a table, column, index, or row, and never touches `user_version`. Safe to run
/// repeatedly.
fn reconcile_schema(conn: &mut Connection) -> Result<(), DbError> {
    // CREATE TABLE/INDEX IF NOT EXISTS — fills in whatever tables are absent.
    conn.execute_batch(SCHEMA)?;

    // ALTER in any columns an older table is missing, all in one transaction.
    let tx = conn.transaction()?;
    for (table, column, alter_sql) in RECONCILABLE_COLUMNS {
        if !has_column(&tx, table, column)? {
            tx.execute_batch(alter_sql)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Apply numbered Rust migrations to step a Rust-managed database
/// (`RUST_BASELINE..=LATEST_VERSION`) forward. There are none beyond the baseline
/// yet, so this only has work to do once `LATEST_VERSION` is bumped above
/// `RUST_BASELINE`. Adding one is a single `match` arm — see the worked example
/// in the body — each running its DDL and bumping `user_version` in one
/// transaction.
fn apply_rust_migrations(conn: &mut Connection, mut version: u32) -> Result<(), DbError> {
    while version < LATEST_VERSION {
        let next = version + 1;
        let mut tx = conn.transaction()?;
        run_rust_migration(&mut tx, next)?;
        tx.execute_batch(&format!("PRAGMA user_version = {next};"))?;
        tx.commit()?;
        version = next;
    }
    Ok(())
}

/// The DDL for a single Rust-managed migration step. The fallthrough rejects an
/// unknown version. To add a step, give it an arm, e.g.:
/// `12 => tx.execute_batch("ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")?,`
fn run_rust_migration(tx: &mut rusqlite::Transaction<'_>, version: u32) -> Result<(), DbError> {
    let _ = tx;
    match version {
        _ => Err(DbError::Other(format!("no Rust migration for version {version}"))),
    }
}

/// Reconcile the on-disk schema with the current desired schema, choosing the
/// path from `PRAGMA user_version`:
///
/// * `uv > LATEST_VERSION` → reject (a genuinely newer schema / app downgrade).
///   A Drift-era database has `uv <= 10 < RUST_BASELINE`, so it never trips this.
/// * `uv <= DRIFT_FINAL` (Drift v1..=10, or unversioned-Rust `uv == 0`) →
///   `reconcile_schema`: idempotent bring-up to the full schema, stamp baseline.
/// * `RUST_BASELINE..=LATEST_VERSION` → run numbered Rust migrations forward.
fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    let uv: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if uv > LATEST_VERSION {
        return Err(DbError::Other(format!(
            "database schema v{uv} is newer than this build supports (v{LATEST_VERSION})"
        )));
    }
    if uv <= DRIFT_FINAL {
        reconcile_schema(conn)?;
        conn.execute_batch(&format!("PRAGMA user_version = {RUST_BASELINE};"))?;
    } else {
        // A Rust-managed database. Reconcile defensively (cheap + idempotent),
        // then apply any numbered migrations above the baseline.
        reconcile_schema(conn)?;
        apply_rust_migrations(conn, uv)?;
    }
    Ok(())
}

/// The SQLite-backed store. Lives behind Tauri's managed `State`.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut conn = Connection::open(path)?;
        apply_pragmas(&conn)?;
        migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn open_in_memory() -> Result<Self, DbError> {
        let mut conn = Connection::open_in_memory()?;
        apply_pragmas(&conn)?;
        migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("db poisoned")
    }

    // ---- projects ----

    pub fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>, DbError> {
        let conn = self.lock();
        let sql = if include_archived {
            "SELECT * FROM projects ORDER BY sort_order ASC, last_opened_at DESC"
        } else {
            "SELECT * FROM projects WHERE archived_at IS NULL \
             ORDER BY sort_order ASC, last_opened_at DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], project_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn upsert_project(&self, p: &Project) -> Result<(), DbError> {
        self.lock().execute(
            "INSERT INTO projects \
               (project_root, display_name, created_at, last_opened_at, sort_order, archived_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
             ON CONFLICT(project_root) DO UPDATE SET \
               display_name = excluded.display_name, \
               last_opened_at = excluded.last_opened_at, \
               sort_order = excluded.sort_order, \
               archived_at = excluded.archived_at",
            params![
                p.project_root,
                p.display_name,
                p.created_at,
                p.last_opened_at,
                p.sort_order,
                p.archived_at
            ],
        )?;
        Ok(())
    }

    pub fn set_project_archived(&self, root: &str, archived_at: Option<i64>) -> Result<(), DbError> {
        self.lock().execute(
            "UPDATE projects SET archived_at = ?2 WHERE project_root = ?1",
            params![root, archived_at],
        )?;
        Ok(())
    }

    pub fn touch_project(&self, root: &str, ts: i64) -> Result<(), DbError> {
        self.lock().execute(
            "UPDATE projects SET last_opened_at = ?2 WHERE project_root = ?1",
            params![root, ts],
        )?;
        Ok(())
    }

    pub fn delete_project(&self, root: &str) -> Result<(), DbError> {
        self.lock()
            .execute("DELETE FROM projects WHERE project_root = ?1", params![root])?;
        Ok(())
    }

    // ---- chats ----

    pub fn list_chats(&self, project_root: &str) -> Result<Vec<Chat>, DbError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM chats WHERE project_root = ?1 \
             ORDER BY sort_order ASC, last_activity_at DESC",
        )?;
        let rows = stmt.query_map(params![project_root], chat_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn upsert_chat(&self, c: &Chat) -> Result<(), DbError> {
        self.lock().execute(
            "INSERT INTO chats \
               (chat_id, project_root, title, agent_id, skill_id, session_id, labels_json, \
                status, task_brief_text, created_at, last_activity_at, sort_order) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) \
             ON CONFLICT(chat_id) DO UPDATE SET \
               title = excluded.title, agent_id = excluded.agent_id, \
               skill_id = excluded.skill_id, session_id = excluded.session_id, \
               labels_json = excluded.labels_json, status = excluded.status, \
               task_brief_text = excluded.task_brief_text, \
               last_activity_at = excluded.last_activity_at, sort_order = excluded.sort_order",
            params![
                c.chat_id, c.project_root, c.title, c.agent_id, c.skill_id, c.session_id,
                c.labels_json, c.status, c.task_brief_text, c.created_at, c.last_activity_at,
                c.sort_order
            ],
        )?;
        Ok(())
    }

    pub fn delete_chat(&self, chat_id: &str) -> Result<(), DbError> {
        self.lock()
            .execute("DELETE FROM chats WHERE chat_id = ?1", params![chat_id])?;
        Ok(())
    }

    // ---- project settings ----

    pub fn get_settings(&self, root: &str) -> Result<Option<ProjectSettings>, DbError> {
        let conn = self.lock();
        let mut stmt = conn.prepare("SELECT * FROM project_settings WHERE project_root = ?1")?;
        let mut rows = stmt.query_map(params![root], settings_from_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn upsert_settings(&self, s: &ProjectSettings) -> Result<(), DbError> {
        self.lock().execute(
            "INSERT INTO project_settings \
               (project_root, vm_service_url, default_agent_id, last_chat_id, pane_sizes, \
                last_used_at, avd_id, avd_name, connection_mode, flutter_run_args, target_file, \
                validator_command, emulator_launch_options, emulator_idle_shutdown, \
                auto_boot_on_select, first_run_celebrated, context_storage_mode, \
                context_storage_custom_path) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18) \
             ON CONFLICT(project_root) DO UPDATE SET \
               vm_service_url = excluded.vm_service_url, \
               default_agent_id = excluded.default_agent_id, \
               last_chat_id = excluded.last_chat_id, pane_sizes = excluded.pane_sizes, \
               last_used_at = excluded.last_used_at, avd_id = excluded.avd_id, \
               avd_name = excluded.avd_name, connection_mode = excluded.connection_mode, \
               flutter_run_args = excluded.flutter_run_args, target_file = excluded.target_file, \
               validator_command = excluded.validator_command, \
               emulator_launch_options = excluded.emulator_launch_options, \
               emulator_idle_shutdown = excluded.emulator_idle_shutdown, \
               auto_boot_on_select = excluded.auto_boot_on_select, \
               first_run_celebrated = excluded.first_run_celebrated, \
               context_storage_mode = excluded.context_storage_mode, \
               context_storage_custom_path = excluded.context_storage_custom_path",
            params![
                s.project_root, s.vm_service_url, s.default_agent_id, s.last_chat_id, s.pane_sizes,
                s.last_used_at, s.avd_id, s.avd_name, s.connection_mode, s.flutter_run_args,
                s.target_file, s.validator_command, s.emulator_launch_options,
                s.emulator_idle_shutdown, s.auto_boot_on_select, s.first_run_celebrated,
                s.context_storage_mode, s.context_storage_custom_path
            ],
        )?;
        Ok(())
    }

    // ---- pick history ----

    pub fn insert_pick(&self, p: &PickHistory) -> Result<i64, DbError> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO pick_history \
               (project_root, widget_class, creation_file, creation_line, skill_id, agent_id, \
                terminal_id, chat_id, picked_at, widget_context_json) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                p.project_root, p.widget_class, p.creation_file, p.creation_line, p.skill_id,
                p.agent_id, p.terminal_id, p.chat_id, p.picked_at, p.widget_context_json
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_picks(&self, project_root: &str, limit: i64) -> Result<Vec<PickHistory>, DbError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM pick_history WHERE project_root = ?1 \
             ORDER BY picked_at DESC, id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![project_root, limit], pick_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---- run session log ----

    pub fn insert_run(&self, r: &RunSessionLog) -> Result<(), DbError> {
        self.lock().execute(
            "INSERT INTO run_session_log \
               (session_id, project_root, started_at, ended_at, avd_id, avd_name, serial, \
                vm_service_url, target_file, connection_mode, exit_reason, exit_code, \
                hot_reload_count, hot_restart_count, error_count, last_error) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) \
             ON CONFLICT(session_id) DO UPDATE SET \
               project_root = excluded.project_root, started_at = excluded.started_at, \
               ended_at = excluded.ended_at, avd_id = excluded.avd_id, \
               avd_name = excluded.avd_name, serial = excluded.serial, \
               vm_service_url = excluded.vm_service_url, target_file = excluded.target_file, \
               connection_mode = excluded.connection_mode, exit_reason = excluded.exit_reason, \
               exit_code = excluded.exit_code, hot_reload_count = excluded.hot_reload_count, \
               hot_restart_count = excluded.hot_restart_count, error_count = excluded.error_count, \
               last_error = excluded.last_error",
            params![
                r.session_id, r.project_root, r.started_at, r.ended_at, r.avd_id, r.avd_name,
                r.serial, r.vm_service_url, r.target_file, r.connection_mode, r.exit_reason,
                r.exit_code, r.hot_reload_count, r.hot_restart_count, r.error_count, r.last_error
            ],
        )?;
        Ok(())
    }

    pub fn finish_run(
        &self,
        session_id: &str,
        ended_at: i64,
        exit_reason: Option<&str>,
        exit_code: Option<i64>,
    ) -> Result<(), DbError> {
        self.lock().execute(
            "UPDATE run_session_log SET ended_at = ?2, exit_reason = ?3, exit_code = ?4 \
             WHERE session_id = ?1",
            params![session_id, ended_at, exit_reason, exit_code],
        )?;
        Ok(())
    }

    pub fn list_runs(&self, project_root: &str, limit: i64) -> Result<Vec<RunSessionLog>, DbError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM run_session_log WHERE project_root = ?1 \
             ORDER BY started_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![project_root, limit], run_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---- agent run log ----

    pub fn insert_agent_run(&self, a: &AgentRunLog) -> Result<i64, DbError> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO agent_run_log \
               (pick_id, started_at, finished_at, exit_code, hot_reload_count, wrapper_script_path) \
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                a.pick_id, a.started_at, a.finished_at, a.exit_code, a.hot_reload_count,
                a.wrapper_script_path
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn finish_agent_run(
        &self,
        id: i64,
        finished_at: i64,
        exit_code: Option<i64>,
        hot_reload_count: i64,
    ) -> Result<(), DbError> {
        self.lock().execute(
            "UPDATE agent_run_log SET finished_at = ?2, exit_code = ?3, hot_reload_count = ?4 \
             WHERE id = ?1",
            params![id, finished_at, exit_code, hot_reload_count],
        )?;
        Ok(())
    }
}

fn project_from_row(row: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        project_root: row.get("project_root")?,
        display_name: row.get("display_name")?,
        created_at: row.get("created_at")?,
        last_opened_at: row.get("last_opened_at")?,
        sort_order: row.get("sort_order")?,
        archived_at: row.get("archived_at")?,
    })
}

fn chat_from_row(row: &Row) -> rusqlite::Result<Chat> {
    Ok(Chat {
        chat_id: row.get("chat_id")?,
        project_root: row.get("project_root")?,
        title: row.get("title")?,
        agent_id: row.get("agent_id")?,
        skill_id: row.get("skill_id")?,
        session_id: row.get("session_id")?,
        labels_json: row.get("labels_json")?,
        status: row.get("status")?,
        task_brief_text: row.get("task_brief_text")?,
        created_at: row.get("created_at")?,
        last_activity_at: row.get("last_activity_at")?,
        sort_order: row.get("sort_order")?,
    })
}

fn settings_from_row(row: &Row) -> rusqlite::Result<ProjectSettings> {
    Ok(ProjectSettings {
        project_root: row.get("project_root")?,
        vm_service_url: row.get("vm_service_url")?,
        default_agent_id: row.get("default_agent_id")?,
        last_chat_id: row.get("last_chat_id")?,
        pane_sizes: row.get("pane_sizes")?,
        last_used_at: row.get("last_used_at")?,
        avd_id: row.get("avd_id")?,
        avd_name: row.get("avd_name")?,
        connection_mode: row.get("connection_mode")?,
        flutter_run_args: row.get("flutter_run_args")?,
        target_file: row.get("target_file")?,
        validator_command: row.get("validator_command")?,
        emulator_launch_options: row.get("emulator_launch_options")?,
        emulator_idle_shutdown: row.get("emulator_idle_shutdown")?,
        auto_boot_on_select: row.get::<_, i64>("auto_boot_on_select")? != 0,
        first_run_celebrated: row.get::<_, i64>("first_run_celebrated")? != 0,
        context_storage_mode: row.get("context_storage_mode")?,
        context_storage_custom_path: row.get("context_storage_custom_path")?,
    })
}

fn pick_from_row(row: &Row) -> rusqlite::Result<PickHistory> {
    Ok(PickHistory {
        id: row.get("id")?,
        project_root: row.get("project_root")?,
        widget_class: row.get("widget_class")?,
        creation_file: row.get("creation_file")?,
        creation_line: row.get("creation_line")?,
        skill_id: row.get("skill_id")?,
        agent_id: row.get("agent_id")?,
        terminal_id: row.get("terminal_id")?,
        chat_id: row.get("chat_id")?,
        picked_at: row.get("picked_at")?,
        widget_context_json: row.get("widget_context_json")?,
    })
}

fn run_from_row(row: &Row) -> rusqlite::Result<RunSessionLog> {
    Ok(RunSessionLog {
        session_id: row.get("session_id")?,
        project_root: row.get("project_root")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        avd_id: row.get("avd_id")?,
        avd_name: row.get("avd_name")?,
        serial: row.get("serial")?,
        vm_service_url: row.get("vm_service_url")?,
        target_file: row.get("target_file")?,
        connection_mode: row.get("connection_mode")?,
        exit_reason: row.get("exit_reason")?,
        exit_code: row.get("exit_code")?,
        hot_reload_count: row.get("hot_reload_count")?,
        hot_restart_count: row.get("hot_restart_count")?,
        error_count: row.get("error_count")?,
        last_error: row.get("last_error")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_and_chats_round_trip_with_cascade() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_project(&Project {
            project_root: "/p".into(),
            display_name: "Proj".into(),
            created_at: 1,
            last_opened_at: 2,
            sort_order: 0,
            archived_at: None,
        })
        .unwrap();
        db.upsert_chat(&Chat {
            chat_id: "c1".into(),
            project_root: "/p".into(),
            title: "Chat".into(),
            agent_id: "claude".into(),
            skill_id: None,
            session_id: None,
            labels_json: None,
            status: None,
            task_brief_text: None,
            created_at: 1,
            last_activity_at: 3,
            sort_order: 0,
        })
        .unwrap();

        assert_eq!(db.list_projects(false).unwrap().len(), 1);
        assert_eq!(db.list_chats("/p").unwrap().len(), 1);

        // archive hides from the default list but keeps the row.
        db.set_project_archived("/p", Some(99)).unwrap();
        assert_eq!(db.list_projects(false).unwrap().len(), 0);
        assert_eq!(db.list_projects(true).unwrap().len(), 1);

        // delete cascades to chats.
        db.delete_project("/p").unwrap();
        assert_eq!(db.list_chats("/p").unwrap().len(), 0);
    }

    #[test]
    fn settings_default_and_upsert() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_settings("/p").unwrap().is_none());

        let mut s = ProjectSettings::defaults("/p");
        s.default_agent_id = Some("codex".into());
        s.auto_boot_on_select = false;
        db.upsert_settings(&s).unwrap();

        let loaded = db.get_settings("/p").unwrap().unwrap();
        assert_eq!(loaded.default_agent_id.as_deref(), Some("codex"));
        assert!(!loaded.auto_boot_on_select);
        assert_eq!(loaded.connection_mode, "auto");
    }

    #[test]
    fn pick_and_run_history() {
        let db = Database::open_in_memory().unwrap();
        let id = db
            .insert_pick(&PickHistory {
                id: 0,
                project_root: "/p".into(),
                widget_class: "MyButton".into(),
                creation_file: Some("lib/x.dart".into()),
                creation_line: Some(12),
                skill_id: "s".into(),
                agent_id: "claude".into(),
                terminal_id: "t".into(),
                chat_id: None,
                picked_at: 5,
                widget_context_json: "{}".into(),
            })
            .unwrap();
        assert!(id > 0);
        assert_eq!(db.list_picks("/p", 10).unwrap().len(), 1);

        db.insert_run(&RunSessionLog {
            session_id: "run1".into(),
            project_root: "/p".into(),
            started_at: 1,
            ended_at: None,
            avd_id: None,
            avd_name: None,
            serial: None,
            vm_service_url: None,
            target_file: None,
            connection_mode: "auto".into(),
            exit_reason: None,
            exit_code: None,
            hot_reload_count: 0,
            hot_restart_count: 0,
            error_count: 0,
            last_error: None,
        })
        .unwrap();
        db.finish_run("run1", 9, Some("done"), Some(0)).unwrap();
        let runs = db.list_runs("/p", 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].ended_at, Some(9));
        assert_eq!(runs[0].exit_reason.as_deref(), Some("done"));
    }

    fn temp_db_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("pf-db-{tag}-{}.sqlite", std::process::id()))
    }

    fn user_version(conn: &Connection) -> u32 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
    }

    // A Drift v10 project_settings table that is MISSING the v10 context columns
    // — the exact shape that panicked the rejection-guard build.
    const DRIFT_PRE_CONTEXT_PROJECT_SETTINGS: &str = "CREATE TABLE project_settings (
           project_root            TEXT NOT NULL PRIMARY KEY,
           vm_service_url          TEXT,
           default_agent_id        TEXT,
           last_chat_id            TEXT,
           pane_sizes              TEXT,
           last_used_at            INTEGER,
           avd_id                  TEXT,
           avd_name                TEXT,
           connection_mode         TEXT NOT NULL DEFAULT 'auto',
           flutter_run_args        TEXT,
           target_file             TEXT,
           validator_command       TEXT,
           emulator_launch_options TEXT,
           emulator_idle_shutdown  TEXT,
           auto_boot_on_select     INTEGER NOT NULL DEFAULT 1,
           first_run_celebrated    INTEGER NOT NULL DEFAULT 0
         );";

    /// Drift v10 DB whose `project_settings` predates the v10 context columns.
    /// The old rejection guard panicked on this (user_version=10 > LATEST=2);
    /// reconciliation must add the columns and stamp the Rust baseline instead.
    #[test]
    fn drift_v10_missing_context_columns_upgrades() {
        let path = temp_db_path("drift-v10");
        let _ = std::fs::remove_file(&path);

        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(&format!(
                "{DRIFT_PRE_CONTEXT_PROJECT_SETTINGS}
                 INSERT INTO project_settings (project_root, connection_mode)
                   VALUES ('/p', 'auto');
                 PRAGMA user_version = 10;"
            ))
            .unwrap();
            assert_eq!(user_version(&conn), 10);
            assert!(!has_column(&conn, "project_settings", "context_storage_mode").unwrap());
            assert!(!has_column(&conn, "project_settings", "context_storage_custom_path").unwrap());
        }

        {
            // Must SUCCEED, not reject.
            let db = Database::open(&path).unwrap();
            assert_eq!(user_version(&db.lock()), RUST_BASELINE);
            assert!(has_column(&db.lock(), "project_settings", "context_storage_mode").unwrap());
            assert!(
                has_column(&db.lock(), "project_settings", "context_storage_custom_path").unwrap()
            );

            // Existing row survives; new columns read back NULL.
            let loaded = db.get_settings("/p").unwrap().unwrap();
            assert_eq!(loaded.connection_mode, "auto");
            assert!(loaded.context_storage_mode.is_none());
            assert!(loaded.context_storage_custom_path.is_none());

            // get/upsert round-trip the freshly added columns.
            let mut s = ProjectSettings::defaults("/p");
            s.context_storage_mode = Some("custom".into());
            s.context_storage_custom_path = Some("/ctx".into());
            db.upsert_settings(&s).unwrap();
            let loaded = db.get_settings("/p").unwrap().unwrap();
            assert_eq!(loaded.context_storage_mode.as_deref(), Some("custom"));
            assert_eq!(loaded.context_storage_custom_path.as_deref(), Some("/ctx"));
        }
        let _ = std::fs::remove_file(&path);
    }

    /// Drift v2 DB with only a subset of tables/columns: `projects` plus a
    /// `project_settings` missing most of the post-v2 columns. Reconciliation
    /// must create the missing tables and add the missing columns.
    #[test]
    fn drift_v2_partial_schema_reconciles() {
        let path = temp_db_path("drift-v2");
        let _ = std::fs::remove_file(&path);

        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE projects (
                   project_root   TEXT NOT NULL PRIMARY KEY,
                   display_name   TEXT NOT NULL,
                   created_at     INTEGER NOT NULL,
                   last_opened_at INTEGER NOT NULL,
                   sort_order     INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE TABLE project_settings (
                   project_root  TEXT NOT NULL PRIMARY KEY,
                   vm_service_url TEXT,
                   default_agent_id TEXT,
                   last_chat_id  TEXT,
                   pane_sizes    TEXT,
                   last_used_at  INTEGER
                 );
                 INSERT INTO projects
                   (project_root, display_name, created_at, last_opened_at)
                   VALUES ('/p', 'Proj', 1, 2);
                 INSERT INTO project_settings (project_root) VALUES ('/p');
                 PRAGMA user_version = 2;",
            )
            .unwrap();
            // Pre-state: missing tables and columns.
            assert!(!has_column(&conn, "projects", "archived_at").unwrap());
            assert!(!has_column(&conn, "project_settings", "connection_mode").unwrap());
            assert!(!has_column(&conn, "project_settings", "context_storage_mode").unwrap());
        }

        {
            let db = Database::open(&path).unwrap();
            assert_eq!(user_version(&db.lock()), RUST_BASELINE);

            // Missing columns added across the reconciled tables.
            assert!(has_column(&db.lock(), "projects", "archived_at").unwrap());
            assert!(has_column(&db.lock(), "project_settings", "connection_mode").unwrap());
            assert!(has_column(&db.lock(), "project_settings", "validator_command").unwrap());
            assert!(has_column(&db.lock(), "project_settings", "context_storage_mode").unwrap());

            // Existing project + settings rows survive and DAOs work.
            assert_eq!(db.list_projects(false).unwrap().len(), 1);
            let loaded = db.get_settings("/p").unwrap().unwrap();
            assert_eq!(loaded.connection_mode, "auto"); // DEFAULT backfilled.

            // Missing tables were created — their DAOs are usable.
            db.insert_run(&RunSessionLog {
                session_id: "r1".into(),
                project_root: "/p".into(),
                started_at: 1,
                ended_at: None,
                avd_id: None,
                avd_name: None,
                serial: None,
                vm_service_url: None,
                target_file: None,
                connection_mode: "auto".into(),
                exit_reason: None,
                exit_code: None,
                hot_reload_count: 0,
                hot_restart_count: 0,
                error_count: 0,
                last_error: None,
            })
            .unwrap();
            assert_eq!(db.list_runs("/p", 10).unwrap().len(), 1);
        }
        let _ = std::fs::remove_file(&path);
    }

    /// An unversioned Rust DB (`user_version` 0) that already carries every
    /// column. Reconciliation must NOT fail with a duplicate-column error; it
    /// stamps the baseline and leaves the data intact.
    #[test]
    fn unversioned_rust_db_with_all_columns() {
        let path = temp_db_path("unversioned-rust");
        let _ = std::fs::remove_file(&path);

        {
            // Seed the full current schema with user_version left at 0.
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute_batch(
                "INSERT INTO project_settings (project_root, connection_mode)
                   VALUES ('/p', 'auto');",
            )
            .unwrap();
            assert_eq!(user_version(&conn), 0);
            assert!(has_column(&conn, "project_settings", "context_storage_mode").unwrap());
        }

        {
            let db = Database::open(&path).unwrap();
            assert_eq!(user_version(&db.lock()), RUST_BASELINE);

            let loaded = db.get_settings("/p").unwrap().unwrap();
            assert_eq!(loaded.connection_mode, "auto");
            assert!(loaded.context_storage_mode.is_none());

            let mut s = ProjectSettings::defaults("/p");
            s.context_storage_mode = Some("custom".into());
            db.upsert_settings(&s).unwrap();
            assert_eq!(
                db.get_settings("/p").unwrap().unwrap().context_storage_mode.as_deref(),
                Some("custom")
            );
        }
        let _ = std::fs::remove_file(&path);
    }

    /// An empty file opens into the full schema, stamps the baseline, and the
    /// DAOs work end to end.
    #[test]
    fn fresh_db_creates_full_schema() {
        let path = temp_db_path("fresh");
        let _ = std::fs::remove_file(&path);
        {
            let db = Database::open(&path).unwrap();
            assert_eq!(user_version(&db.lock()), RUST_BASELINE);

            db.upsert_project(&Project {
                project_root: "/p".into(),
                display_name: "Proj".into(),
                created_at: 1,
                last_opened_at: 2,
                sort_order: 0,
                archived_at: None,
            })
            .unwrap();
            assert_eq!(db.list_projects(false).unwrap().len(), 1);

            let mut s = ProjectSettings::defaults("/p");
            s.context_storage_mode = Some("custom".into());
            s.context_storage_custom_path = Some("/ctx".into());
            db.upsert_settings(&s).unwrap();
            let loaded = db.get_settings("/p").unwrap().unwrap();
            assert_eq!(loaded.context_storage_mode.as_deref(), Some("custom"));
            assert_eq!(loaded.context_storage_custom_path.as_deref(), Some("/ctx"));

            // Reopen is idempotent (no duplicate-column error).
            drop(db);
            let db = Database::open(&path).unwrap();
            assert_eq!(user_version(&db.lock()), RUST_BASELINE);
        }
        let _ = std::fs::remove_file(&path);
    }

    /// A DB stamped one past LATEST (a genuine downgrade / newer schema) is
    /// rejected rather than silently mangled.
    #[test]
    fn genuinely_newer_schema_is_rejected() {
        let path = temp_db_path("newer");
        let _ = std::fs::remove_file(&path);

        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(&format!("PRAGMA user_version = {};", LATEST_VERSION + 1))
                .unwrap();
            assert_eq!(user_version(&conn), LATEST_VERSION + 1);
        }

        assert!(Database::open(&path).is_err());
        let _ = std::fs::remove_file(&path);
    }
}
