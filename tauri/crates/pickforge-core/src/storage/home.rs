//! Resolve the PickForge home directory — ported from `pickforge_home.dart`.

use std::collections::HashMap;

use super::join;

#[derive(Debug, thiserror::Error)]
#[error("HOME is not set; cannot resolve the PickForge home directory")]
pub struct PickforgeHomeError;

/// `$PICKFORGE_HOME`, else the platform home + `.pickforge`. Reads from `env`
/// when provided, otherwise the process environment.
pub fn pickforge_home(env: Option<&HashMap<String, String>>) -> Result<String, PickforgeHomeError> {
    let get = |key: &str| -> Option<String> {
        match env {
            Some(map) => map.get(key).cloned(),
            None => std::env::var(key).ok(),
        }
    };
    let trimmed = |value: Option<String>| -> Option<String> {
        value.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    };

    if let Some(override_home) = trimmed(get("PICKFORGE_HOME")) {
        return Ok(override_home);
    }

    if cfg!(windows) {
        let base = trimmed(get("USERPROFILE")).unwrap_or_else(|| {
            join(
                &get("HOMEDRIVE").unwrap_or_default(),
                &get("HOMEPATH").unwrap_or_default(),
            )
        });
        return Ok(join(&base, ".pickforge"));
    }

    let home = trimmed(get("HOME")).ok_or(PickforgeHomeError)?;
    Ok(join(&home, ".pickforge"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn honours_explicit_override() {
        let mut env = HashMap::new();
        env.insert("PICKFORGE_HOME".to_string(), "  /custom/home  ".to_string());
        assert_eq!(pickforge_home(Some(&env)).unwrap(), "/custom/home");
    }

    #[cfg(unix)]
    #[test]
    fn falls_back_to_home_dot_pickforge() {
        let mut env = HashMap::new();
        env.insert("HOME".to_string(), "/home/dev".to_string());
        assert_eq!(pickforge_home(Some(&env)).unwrap(), "/home/dev/.pickforge");
    }

    #[cfg(unix)]
    #[test]
    fn errors_without_home() {
        assert!(pickforge_home(Some(&HashMap::new())).is_err());
    }
}
