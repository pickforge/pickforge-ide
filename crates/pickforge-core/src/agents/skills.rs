use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::manager::AgentProvider;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkill {
    pub trigger: String,
    pub name: String,
    pub description: String,
}

pub fn list_agent_skills(provider: AgentProvider) -> Vec<AgentSkill> {
    match provider {
        AgentProvider::ClaudeCode => {
            let Some(home) = resolve_home() else {
                return Vec::new();
            };
            list_agent_skills_from_home(provider, &home)
        }
        AgentProvider::Codex => {
            let Some(codex_home) = resolve_codex_home() else {
                return Vec::new();
            };
            list_codex_skills_from_home(&codex_home)
        }
    }
}

pub fn list_agent_skills_from_home(provider: AgentProvider, home: &Path) -> Vec<AgentSkill> {
    let mut skills = Vec::new();
    match provider {
        AgentProvider::ClaudeCode => {
            scan_claude_skill_dir(&home.join(".claude").join("skills"), &mut skills);
            scan_claude_skill_dir(&home.join(".agents").join("skills"), &mut skills);
            scan_command_dir(&home.join(".claude").join("commands"), &mut skills);
        }
        AgentProvider::Codex => {
            scan_codex_prompt_dir(&home.join(".codex").join("prompts"), &mut skills);
        }
    }
    dedupe_and_sort(skills)
}

fn list_codex_skills_from_home(codex_home: &Path) -> Vec<AgentSkill> {
    let mut skills = Vec::new();
    scan_codex_prompt_dir(&codex_home.join("prompts"), &mut skills);
    dedupe_and_sort(skills)
}

fn resolve_codex_home() -> Option<PathBuf> {
    env_path("CODEX_HOME").or_else(|| resolve_home().map(|home| home.join(".codex")))
}

fn resolve_home() -> Option<PathBuf> {
    env_path("HOME")
        .or_else(|| env_path("USERPROFILE"))
        .or_else(|| {
            let mut drive = env_os("HOMEDRIVE")?;
            let path = env_os("HOMEPATH")?;
            drive.push(path);
            Some(PathBuf::from(drive))
        })
}

fn env_path(key: &str) -> Option<PathBuf> {
    env_os(key).map(PathBuf::from)
}

fn env_os(key: &str) -> Option<OsString> {
    let value = std::env::var_os(key)?;
    if value.to_string_lossy().trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn scan_claude_skill_dir(root: &Path, out: &mut Vec<AgentSkill>) {
    for path in read_dir_paths(root) {
        if !path.is_dir() {
            continue;
        }
        let skill_path = path.join("SKILL.md");
        let Ok(text) = std::fs::read_to_string(skill_path) else {
            continue;
        };
        let fields = frontmatter_fields(&text);
        let name = fields
            .name
            .or_else(|| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_default();
        if name.trim().is_empty() {
            continue;
        }
        out.push(AgentSkill {
            trigger: "/".to_string(),
            name,
            description: fields.description.unwrap_or_default(),
        });
    }
}

fn scan_command_dir(root: &Path, out: &mut Vec<AgentSkill>) {
    for path in read_dir_paths(root) {
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let Some(name) = file_stem(&path) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        out.push(AgentSkill {
            trigger: "/".to_string(),
            name,
            description: first_non_empty_line(&text, true).unwrap_or_default(),
        });
    }
}

fn scan_codex_prompt_dir(root: &Path, out: &mut Vec<AgentSkill>) {
    for path in read_dir_paths(root) {
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let Some(name) = file_stem(&path) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        out.push(AgentSkill {
            trigger: "$".to_string(),
            name,
            description: first_non_empty_line(&text, false).unwrap_or_default(),
        });
    }
}

fn read_dir_paths(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn file_stem(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .map(str::to_string)
}

#[derive(Default)]
struct FrontmatterFields {
    name: Option<String>,
    description: Option<String>,
}

fn frontmatter_fields(text: &str) -> FrontmatterFields {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return FrontmatterFields::default();
    }

    let mut fields = FrontmatterFields::default();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = clean_frontmatter_value(value);
        match key.trim() {
            "name" if !value.is_empty() => fields.name = Some(value),
            "description" if !value.is_empty() => fields.description = Some(value),
            _ => {}
        }
    }
    fields
}

fn clean_frontmatter_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn first_non_empty_line(text: &str, skip_frontmatter: bool) -> Option<String> {
    let mut lines = text.lines();
    if skip_frontmatter && lines.next().map(str::trim) == Some("---") {
        for line in &mut lines {
            if line.trim() == "---" {
                break;
            }
        }
    } else {
        lines = text.lines();
    }

    lines
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn dedupe_and_sort(skills: Vec<AgentSkill>) -> Vec<AgentSkill> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for skill in skills {
        let key = (skill.trigger.clone(), skill.name.clone());
        if seen.insert(key) {
            deduped.push(skill);
        }
    }
    deduped.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.trigger.cmp(&b.trigger)));
    deduped
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    static HOME_LOCK: Mutex<()> = Mutex::new(());

    struct TempHome {
        path: PathBuf,
    }

    impl TempHome {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "pickforge-agent-skills-{name}-{}-{stamp}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn write(&self, relative: &str, text: &str) {
            let path = self.path.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(path, text).unwrap();
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn scans_agent_skills_from_home_and_dedupes_by_trigger_name() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = TempHome::new("claude");
        home.write(
            ".claude/skills/review/SKILL.md",
            "---\nname: review-code\ndescription: Review code changes\n---\n",
        );
        home.write(
            ".agents/skills/review/SKILL.md",
            "---\nname: review-code\ndescription: Duplicate should lose\n---\n",
        );
        home.write(".agents/skills/no-frontmatter/SKILL.md", "Body");
        home.write(
            ".claude/commands/fix.md",
            "---\ndescription: command frontmatter\n---\n\nFix the selected issue\n",
        );
        home.write(".claude/commands/empty.md", "\n\n");

        let old_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &home.path);
        let skills = list_agent_skills(AgentProvider::ClaudeCode);
        restore_home(old_home);

        assert_eq!(
            skills,
            vec![
                AgentSkill {
                    trigger: "/".to_string(),
                    name: "empty".to_string(),
                    description: "".to_string(),
                },
                AgentSkill {
                    trigger: "/".to_string(),
                    name: "fix".to_string(),
                    description: "Fix the selected issue".to_string(),
                },
                AgentSkill {
                    trigger: "/".to_string(),
                    name: "no-frontmatter".to_string(),
                    description: "".to_string(),
                },
                AgentSkill {
                    trigger: "/".to_string(),
                    name: "review-code".to_string(),
                    description: "Review code changes".to_string(),
                },
            ]
        );
    }

    #[test]
    fn scans_codex_prompts_from_home() {
        let home = TempHome::new("codex");
        home.write(".codex/prompts/plan.md", "\nPlan the smallest change\n");
        home.write(".codex/prompts/review.md", "Review the diff\n");

        assert_eq!(
            list_agent_skills_from_home(AgentProvider::Codex, &home.path),
            vec![
                AgentSkill {
                    trigger: "$".to_string(),
                    name: "plan".to_string(),
                    description: "Plan the smallest change".to_string(),
                },
                AgentSkill {
                    trigger: "$".to_string(),
                    name: "review".to_string(),
                    description: "Review the diff".to_string(),
                },
            ]
        );
    }

    #[test]
    fn list_agent_skills_falls_back_to_userprofile() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = TempHome::new("userprofile");
        home.write(
            ".claude/skills/review/SKILL.md",
            "---\nname: review-code\ndescription: Review code changes\n---\n",
        );

        let old_home = std::env::var_os("HOME");
        let old_userprofile = std::env::var_os("USERPROFILE");
        let old_homedrive = std::env::var_os("HOMEDRIVE");
        let old_homepath = std::env::var_os("HOMEPATH");
        std::env::remove_var("HOME");
        std::env::set_var("USERPROFILE", &home.path);
        std::env::remove_var("HOMEDRIVE");
        std::env::remove_var("HOMEPATH");
        let skills = list_agent_skills(AgentProvider::ClaudeCode);
        restore_env("HOME", old_home);
        restore_env("USERPROFILE", old_userprofile);
        restore_env("HOMEDRIVE", old_homedrive);
        restore_env("HOMEPATH", old_homepath);

        assert_eq!(
            skills,
            vec![AgentSkill {
                trigger: "/".to_string(),
                name: "review-code".to_string(),
                description: "Review code changes".to_string(),
            }]
        );
    }

    #[test]
    fn list_agent_skills_honors_codex_home() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = TempHome::new("home-codex");
        let codex_home = TempHome::new("codex-home");
        home.write(".codex/prompts/home.md", "Home prompt\n");
        codex_home.write("prompts/override.md", "Override prompt\n");

        let old_home = std::env::var_os("HOME");
        let old_codex_home = std::env::var_os("CODEX_HOME");
        std::env::set_var("HOME", &home.path);
        std::env::set_var("CODEX_HOME", &codex_home.path);
        let skills = list_agent_skills(AgentProvider::Codex);
        restore_env("HOME", old_home);
        restore_env("CODEX_HOME", old_codex_home);

        assert_eq!(
            skills,
            vec![AgentSkill {
                trigger: "$".to_string(),
                name: "override".to_string(),
                description: "Override prompt".to_string(),
            }]
        );
    }

    #[test]
    fn missing_skill_dirs_return_empty_lists() {
        let home = TempHome::new("empty");
        assert!(list_agent_skills_from_home(AgentProvider::ClaudeCode, &home.path).is_empty());
        assert!(list_agent_skills_from_home(AgentProvider::Codex, &home.path).is_empty());
    }

    fn restore_home(old_home: Option<std::ffi::OsString>) {
        restore_env("HOME", old_home);
    }

    fn restore_env(key: &str, old_value: Option<std::ffi::OsString>) {
        if let Some(old_value) = old_value {
            std::env::set_var(key, old_value);
        } else {
            std::env::remove_var(key);
        }
    }
}
