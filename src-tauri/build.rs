use std::path::{Path, PathBuf};

fn main() {
    stage_mcp_sidecar();
    stage_claude_bridge_sidecar();
    tauri_build::build()
}

/// Stage the `pickforge-mcp` sidecar at the triple-suffixed path the Tauri
/// bundler's build-time `externalBin` check expects, by copying the binary Cargo
/// already produced under `target/<profile>/`.
///
/// We deliberately do NOT invoke `cargo build` here: a nested build against the
/// same target dir deadlocks on Cargo's build lock. Instead:
///   - full `tauri build` runs `scripts/build-sidecar.mjs` first (wired into
///     `beforeBuildCommand`), which builds + stages the real adapter, so the copy
///     below is a no-op refresh;
///   - a bare `cargo build --workspace` builds `pickforge-mcp` as a member,
///     leaving the binary in `target/<profile>/` for this copy.
/// If neither produced it (e.g. `cargo check`, which never links binaries), we
/// only warn: `tauri-build`'s own externalBin check still needs the staged file,
/// so CI runs `bun run sidecar` before the cargo steps.
fn stage_mcp_sidecar() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace = manifest_dir.parent().unwrap().to_path_buf();
    let triple = std::env::var("TARGET").unwrap();
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let ext = if triple.contains("windows") { ".exe" } else { "" };

    println!("cargo:rerun-if-changed=../crates/pickforge-mcp/src/main.rs");
    println!("cargo:rerun-if-changed=../crates/pickforge-mcp/Cargo.toml");

    let dest_dir = manifest_dir.join("binaries");
    let dest = dest_dir.join(format!("pickforge-mcp-{triple}{ext}"));
    let built = workspace
        .join("target")
        .join(&profile)
        .join(format!("pickforge-mcp{ext}"));

    if built.exists() {
        std::fs::create_dir_all(&dest_dir).expect("create src-tauri/binaries");
        std::fs::copy(&built, &dest).unwrap_or_else(|e| {
            panic!("staging pickforge-mcp sidecar to {}: {e}", dest.display())
        });
    } else if !dest.exists() {
        // No staged binary, and Cargo hasn't emitted one (e.g. plain `cargo check`,
        // which never links binaries). Warn instead of panicking so dev/CI workspace
        // checks pass. Release builds always stage it first via `beforeBuildCommand`
        // -> `bun run sidecar`. `tauri-build` still wants the externalBin to exist at
        // build-script time, so CI runs `bun run sidecar` before the cargo steps.
        println!(
            "cargo:warning=pickforge-mcp sidecar not staged ({} missing); run \
             `bun run sidecar` to wire the externalBin (release builds do this \
             automatically).",
            built.display()
        );
    }
}

fn stage_claude_bridge_sidecar() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let triple = std::env::var("TARGET").unwrap();
    let ext = if triple.contains("windows") { ".exe" } else { "" };

    println!("cargo:rerun-if-changed=../scripts/claude-bridge.ts");

    let dest_dir = manifest_dir.join("binaries");
    let dest = dest_dir.join(format!("pickforge-claude-bridge-{triple}{ext}"));

    if dest.exists() {
        return;
    }

    std::fs::create_dir_all(&dest_dir).expect("create src-tauri/binaries");
    std::fs::write(
        &dest,
        b"#!/bin/sh\nprintf '%s\\n' 'pickforge-claude-bridge placeholder: run `bun run sidecar` to build the packaged sidecar.' >&2\nexit 127\n",
    )
    .unwrap_or_else(|e| {
        panic!(
            "staging pickforge-claude-bridge placeholder to {}: {e}",
            dest.display()
        )
    });
    make_executable(&dest);

    println!(
        "cargo:warning=pickforge-claude-bridge placeholder staged at {}; release builds overwrite it via `bun run sidecar`.",
        dest.display()
    );
}

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = std::fs::metadata(path)
        .unwrap_or_else(|e| panic!("reading permissions for {}: {e}", path.display()))
        .permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    std::fs::set_permissions(path, permissions)
        .unwrap_or_else(|e| panic!("setting executable bit on {}: {e}", path.display()));
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) {}
