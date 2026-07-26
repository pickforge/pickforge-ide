pub mod auth_presence;
pub mod claude_bridge;
pub mod claude_stream;
pub mod codex_app;
pub mod codex_exec;
pub mod event;
pub mod omp_acp;
pub mod manager;
pub mod pi_kit;
pub mod pi_kit_context;
pub mod pi_kit_runs;
pub mod pi_rpc;
pub mod remote_exec;
pub mod skills;

pub use auth_presence::{
    claude_auth_status_authenticated, codex_login_status_authenticated, AuthPresenceProbe,
    AuthPresenceState, AuthPresenceUnknownReason,
};
pub use event::*;
pub use manager::{AgentChatError, AgentChatManager, AgentProvider, AgentStartOverrides, Engine};
pub use omp_acp::{
    validate_omp_mcp_servers, OmpAcpClient, OmpAcpError, OmpAcpHandshake, OmpAcpOptions,
    OmpAcpSessionOpen,
};
pub use pi_kit::{detect_pi_kit, PiKitDetection};
pub use pi_kit_context::{clear_forge_context, write_forge_context};
pub use pi_kit_runs::{
    abandon_pi_kit_lane, list_pi_kit_run_page, list_pi_kit_runs, pi_kit_data_dir, pi_kit_runs_dir, PiKitAbandonOutcome,
    PiKitLaneStatus, PiKitRunEntry, PiKitRunPage, PiKitRunStatus, PiKitRunTotals, PIKIT_DATA_DIR_ENV,
};
pub use remote_exec::{RemoteExec, RemoteExecError};
pub use skills::{list_agent_skills, AgentSkill};
