use std::path::PathBuf;

fn main() {
    stage_mcp_sidecar();
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
///   - a bare `cargo build/check --workspace` builds `pickforge-mcp` as a member,
///     leaving the binary in `target/<profile>/` for this copy.
/// If neither produced it yet, we fail with a clear instruction rather than ship
/// a placeholder.
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
        panic!(
            "pickforge-mcp sidecar is not built: {} is missing.\n\
             Run `bun run sidecar` (or `cargo build -p pickforge-mcp`) first, then \
             rebuild. A full `tauri build` does this automatically via \
             `beforeBuildCommand`.",
            built.display()
        );
    }
}
