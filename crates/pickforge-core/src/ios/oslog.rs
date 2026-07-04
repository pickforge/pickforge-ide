use serde::Serialize;

use super::{command_failed, run_ios_command, IosError, IOS_CAPTURE_TIMEOUT};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OsLogLevel {
    Debug,
    Info,
    Default,
    Error,
    Fault,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsLogEvent {
    pub timestamp: String,
    pub level: OsLogLevel,
    pub process: String,
    pub message: String,
}

pub fn parse_oslog_line(line: &str) -> Option<OsLogEvent> {
    let line = line.trim_end();
    if line.trim().is_empty() {
        return None;
    }

    let (date, rest) = take_token(line)?;
    let (time, rest) = take_token(rest)?;
    let (level_code, rest) = take_token(rest)?;
    let (source, rest) = take_token(rest)?;
    if !is_date(date) || !is_time(time) {
        return None;
    }

    let level = match level_code {
        "Db" => OsLogLevel::Debug,
        "In" => OsLogLevel::Info,
        "Df" => OsLogLevel::Default,
        "E" => OsLogLevel::Error,
        "F" => OsLogLevel::Fault,
        _ => return None,
    };

    let pid_start = source.find('[')?;
    let pid_end = source.rfind(']')?;
    if pid_start == 0 || pid_end <= pid_start {
        return None;
    }

    let mut message = rest.trim_start();
    if message.starts_with('[') {
        if let Some(end) = message.find(']') {
            message = message[end + 1..].trim_start();
        }
    }

    Some(OsLogEvent {
        timestamp: format!("{date} {time}"),
        level,
        process: source[..pid_start].to_string(),
        message: message.to_string(),
    })
}

pub fn dump_recent(udid: &str, last: &str) -> Result<Vec<OsLogEvent>, IosError> {
    let out = run_ios_command(
        "xcrun",
        &[
            "simctl",
            "spawn",
            udid,
            "log",
            "show",
            "--style",
            "compact",
            "--info",
            "--debug",
            "--last",
            last,
        ],
        IOS_CAPTURE_TIMEOUT,
    )?;
    if !out.success() {
        return Err(command_failed("xcrun", &out));
    }
    Ok(out
        .stdout_utf8()
        .lines()
        .filter_map(parse_oslog_line)
        .collect())
}

fn take_token(input: &str) -> Option<(&str, &str)> {
    let input = input.trim_start();
    if input.is_empty() {
        return None;
    }
    let end = input.find(char::is_whitespace).unwrap_or(input.len());
    Some((&input[..end], &input[end..]))
}

fn is_date(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2].is_ascii_digit()
        && b[3].is_ascii_digit()
        && b[4] == b'-'
        && b[5].is_ascii_digit()
        && b[6].is_ascii_digit()
        && b[7] == b'-'
        && b[8].is_ascii_digit()
        && b[9].is_ascii_digit()
}

fn is_time(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() >= 8
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b':'
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
        && b[5] == b':'
        && b[6].is_ascii_digit()
        && b[7].is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_compact_level() {
        let cases = [
            ("Db", OsLogLevel::Debug),
            ("In", OsLogLevel::Info),
            ("Df", OsLogLevel::Default),
            ("E", OsLogLevel::Error),
            ("F", OsLogLevel::Fault),
        ];

        for (code, level) in cases {
            let line =
                format!("2026-07-04 12:34:56.789 {code} MyApp[1234:abcd] [com.example:ui] message");
            let event = parse_oslog_line(&line).unwrap();
            assert_eq!(event.timestamp, "2026-07-04 12:34:56.789");
            assert_eq!(event.level, level);
            assert_eq!(event.process, "MyApp");
            assert_eq!(event.message, "message");
        }
    }

    #[test]
    fn drops_header_noise_and_blank_lines() {
        assert!(parse_oslog_line("").is_none());
        assert!(parse_oslog_line("Timestamp Thread Type Activity PID TTL").is_none());
        assert!(parse_oslog_line("Filtering the log data using predicate").is_none());
    }

    #[test]
    fn uses_message_after_pid_when_source_block_is_missing() {
        let event =
            parse_oslog_line("2026-07-04 12:34:56.789 Df MyApp[1234:abcd] plain message").unwrap();
        assert_eq!(event.message, "plain message");
    }

    #[test]
    fn parses_multiline_fixture() {
        let fixture = "Timestamp Thread Type Activity PID TTL\n\
                       2026-07-04 12:34:56.789 In MyApp[1234:abcd] [com.example:ui] ready\n\
                       Filtering the log data using predicate\n\
                       2026-07-04 12:35:00.001 E MyApp[1234:abcd] failed\n";
        let events: Vec<OsLogEvent> = fixture.lines().filter_map(parse_oslog_line).collect();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].level, OsLogLevel::Info);
        assert_eq!(events[0].message, "ready");
        assert_eq!(events[1].level, OsLogLevel::Error);
        assert_eq!(events[1].message, "failed");
    }
}
