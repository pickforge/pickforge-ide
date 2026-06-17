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

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  project_root   TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  archived_at    INTEGER
);

CREATE TABLE IF NOT EXISTS chats (
  chat_id          TEXT PRIMARY KEY,
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
  project_root                TEXT PRIMARY KEY,
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
  auto_boot_on_select         INTEGER NOT NULL DEFAULT 1,
  first_run_celebrated        INTEGER NOT NULL DEFAULT 0,
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
  session_id        TEXT PRIMARY KEY,
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
"#;

/// The SQLite-backed store. Lives behind Tauri's managed `State`.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn open_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
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
            "SELECT * FROM pick_history WHERE project_root = ?1 ORDER BY picked_at DESC LIMIT ?2",
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
               ended_at = excluded.ended_at, exit_reason = excluded.exit_reason, \
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
}
