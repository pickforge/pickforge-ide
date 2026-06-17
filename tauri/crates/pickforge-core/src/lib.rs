//! PickForge core — the UI-agnostic OS-integration + pure-logic layer.
//!
//! This crate is deliberately free of any UI / IPC framework so the same core
//! can back the Tauri shell today and anything else tomorrow. Phase 0 ships the
//! PTY subsystem; later phases add transcript, process runner, device bridges,
//! target adapters, VM Service, storage and agent prep.

pub mod pty;

pub use pty::{PtyError, PtyEvent, PtyManager, PtySink, SpawnOptions};
