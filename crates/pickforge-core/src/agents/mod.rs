pub mod claude_bridge;
pub mod claude_stream;
pub mod codex_app;
pub mod codex_exec;
pub mod event;
pub mod omp_acp;
pub mod manager;
pub mod pi_kit;
pub mod pi_rpc;
pub mod remote_exec;
pub mod skills;

pub use event::*;
pub use manager::{AgentChatError, AgentChatManager, AgentProvider, AgentStartOverrides, Engine};
pub use omp_acp::{
    validate_omp_mcp_servers, OmpAcpClient, OmpAcpError, OmpAcpHandshake, OmpAcpOptions,
    OmpAcpSessionOpen,
};
pub use pi_kit::{detect_pi_kit, PiKitDetection};
pub use remote_exec::{RemoteExec, RemoteExecError};
pub use skills::{list_agent_skills, AgentSkill};
