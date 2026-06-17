//! `adb logcat` line → log event — ported from `android_logcat_parser.dart`.
//! Reads the priority letter (V/D/I/W/E/F) from the threadtime or brief formats;
//! E/F → error, W → warning, else → info.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub line: String,
    pub level: LogLevel,
    pub source: String,
}

/// Parse one logcat line, or `None` when blank.
pub fn logcat_event(line: &str) -> Option<LogEvent> {
    if line.trim().is_empty() {
        return None;
    }
    Some(LogEvent {
        line: line.trim_end().to_string(),
        level: level_for(line),
        source: "logcat".to_string(),
    })
}

fn level_for(line: &str) -> LogLevel {
    match priority_letter(line) {
        Some('E') | Some('F') => LogLevel::Error,
        Some('W') => LogLevel::Warning,
        _ => LogLevel::Info,
    }
}

fn priority_letter(line: &str) -> Option<char> {
    const LEVELS: &str = "VDIWEF";

    // brief: "L/Tag(pid): msg"
    let bytes = line.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b'/' {
        let c = bytes[0] as char;
        if LEVELS.contains(c) {
            return Some(c);
        }
    }

    // threadtime: "MM-DD HH:MM:SS.mmm PID TID L ..."
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() >= 5 && is_month_day(tokens[0]) && tokens[4].len() == 1 {
        let c = tokens[4].chars().next().unwrap();
        if LEVELS.contains(c) {
            return Some(c);
        }
    }
    None
}

fn is_month_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b'-'
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_lines_are_dropped() {
        assert!(logcat_event("   ").is_none());
    }

    #[test]
    fn threadtime_levels() {
        let e = logcat_event("06-17 12:00:00.123  1234  1300 E ActivityManager: boom").unwrap();
        assert_eq!(e.level, LogLevel::Error);
        assert_eq!(e.source, "logcat");
        let w = logcat_event("06-17 12:00:00.123  1234  1300 W Tag: warn").unwrap();
        assert_eq!(w.level, LogLevel::Warning);
        let i = logcat_event("06-17 12:00:00.123  1234  1300 I Tag: info").unwrap();
        assert_eq!(i.level, LogLevel::Info);
    }

    #[test]
    fn brief_levels() {
        assert_eq!(logcat_event("E/Tag(123): bad").unwrap().level, LogLevel::Error);
        assert_eq!(logcat_event("I/Tag(123): ok").unwrap().level, LogLevel::Info);
    }
}
