//! Two-file terminal transcript writer — ported from `transcript_recorder.dart`.
//!
//! Layout (per session dir):
//!   transcript.log        raw PTY bytes (head-truncated to `max_bytes`)
//!   transcript.spans.bin  LEB128 varint records: start, len, fg, bg, style
//!   meta.json             { schemaVersion, bytes, updatedAtUnixMs }
//!
//! Decoupled from storage-path resolution: callers pass the target directory
//! (the storage service lands in Phase 3 and supplies it).

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::ansi::{parse_ansi, AnsiSpan};

/// Escape sequences stamped at a session boundary so a fresh shell's replay is
/// consistent regardless of how the previous session left the terminal modes
/// (mouse reporting, alt screen, bracketed paste, cursor, wrap, attributes).
pub const TERMINAL_MODE_RESETS: &str =
    "\x1b[?1000l\x1b[?1049l\x1b[?47l\x1b[?2004l\x1b[?25h\x1b[?7h\x1b[0m";

const DEFAULT_MAX_BYTES: u64 = 5 * 1024 * 1024;

pub struct TranscriptRecorder {
    dir: PathBuf,
    max_bytes: u64,
    truncate_at: u64,
    log: Option<BufWriter<File>>,
    spans: Option<BufWriter<File>>,
}

impl TranscriptRecorder {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self::with_limits(dir, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES + 1024 * 1024)
    }

    pub fn with_limits(dir: impl Into<PathBuf>, max_bytes: u64, truncate_at: u64) -> Self {
        Self {
            dir: dir.into(),
            max_bytes,
            truncate_at,
            log: None,
            spans: None,
        }
    }

    fn log_path(&self) -> PathBuf {
        self.dir.join("transcript.log")
    }
    fn spans_path(&self) -> PathBuf {
        self.dir.join("transcript.spans.bin")
    }
    fn meta_path(&self) -> PathBuf {
        self.dir.join("meta.json")
    }

    /// Open (creating) the log + spans files in append mode. If the log already
    /// has content, stamp the terminal-mode resets first.
    pub fn open(&mut self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let had_history = std::fs::metadata(self.log_path())
            .map(|m| m.len() > 0)
            .unwrap_or(false);

        let mut log = BufWriter::new(append_file(&self.log_path())?);
        let spans = BufWriter::new(append_file(&self.spans_path())?);
        if had_history {
            log.write_all(TERMINAL_MODE_RESETS.as_bytes())?;
        }
        self.log = Some(log);
        self.spans = Some(spans);
        Ok(())
    }

    /// Append a chunk of raw PTY bytes: the bytes go to the log verbatim; their
    /// parsed style spans go to the spans file.
    pub fn append(&mut self, data: &[u8]) -> std::io::Result<()> {
        let text = String::from_utf8_lossy(data);
        let parsed = parse_ansi(&text);

        if let Some(log) = self.log.as_mut() {
            log.write_all(data)?;
        }
        if let Some(spans) = self.spans.as_mut() {
            let mut buf = Vec::new();
            for span in &parsed.spans {
                encode_span(span, &mut buf);
            }
            if !buf.is_empty() {
                spans.write_all(&buf)?;
            }
        }
        Ok(())
    }

    pub fn flush(&mut self) -> std::io::Result<()> {
        if let Some(log) = self.log.as_mut() {
            log.flush()?;
        }
        if let Some(spans) = self.spans.as_mut() {
            spans.flush()?;
        }
        self.maybe_truncate()?;
        self.write_meta()?;
        Ok(())
    }

    pub fn close(&mut self) -> std::io::Result<()> {
        self.flush()?;
        self.log = None; // dropping the BufWriter flushes + closes
        self.spans = None;
        Ok(())
    }

    /// Head-truncate the log to the last `max_bytes` once it grows past
    /// `truncate_at`. (Mirrors the Dart recorder: only the log is truncated;
    /// the spans index is best-effort decoration and may outlive its offsets.)
    fn maybe_truncate(&mut self) -> std::io::Result<()> {
        let size = match std::fs::metadata(self.log_path()) {
            Ok(m) => m.len(),
            Err(_) => return Ok(()),
        };
        if size <= self.truncate_at {
            return Ok(());
        }

        // Drop the append handle, rewrite the file, reopen at the new end.
        self.log = None;
        let mut bytes = Vec::new();
        File::open(self.log_path())?.read_to_end(&mut bytes)?;
        let keep_from = bytes.len().saturating_sub(self.max_bytes as usize);
        std::fs::write(self.log_path(), &bytes[keep_from..])?;
        self.log = Some(BufWriter::new(append_file(&self.log_path())?));
        Ok(())
    }

    fn write_meta(&self) -> std::io::Result<()> {
        let size = std::fs::metadata(self.log_path())
            .map(|m| m.len())
            .unwrap_or(0);
        let updated_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let json = format!(
            "{{\"schemaVersion\":1,\"bytes\":{size},\"updatedAtUnixMs\":{updated_ms}}}"
        );
        std::fs::write(self.meta_path(), json)
    }

    /// Delete a session's transcript files so a recycled pane id starts clean.
    pub fn delete_transcript(dir: impl AsRef<Path>) {
        let dir = dir.as_ref();
        for name in ["transcript.log", "transcript.spans.bin"] {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
}

fn append_file(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

fn encode_span(span: &AnsiSpan, out: &mut Vec<u8>) {
    let style =
        (span.bold as u64) | ((span.italic as u64) << 1) | ((span.underline as u64) << 2);
    write_varint(out, span.start as u64);
    write_varint(out, (span.end - span.start) as u64);
    write_varint(out, span.fg.map_or(255, u64::from));
    write_varint(out, span.bg.map_or(255, u64::from));
    write_varint(out, style);
}

fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-transcript-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn writes_log_spans_and_meta() {
        let dir = temp_dir("basic");
        let mut rec = TranscriptRecorder::new(&dir);
        rec.open().unwrap();
        rec.append(b"\x1b[31mred\x1b[0m\n").unwrap();
        rec.close().unwrap();

        let log = std::fs::read(dir.join("transcript.log")).unwrap();
        assert_eq!(log, b"\x1b[31mred\x1b[0m\n", "log keeps raw bytes");

        let spans = std::fs::read(dir.join("transcript.spans.bin")).unwrap();
        // one span as LEB128 varints: start=0 -> [0], len=3 -> [3], fg=1 -> [1],
        // bg=None=255 -> [0xFF,0x01], style=0 -> [0].
        assert_eq!(spans, vec![0, 3, 1, 0xFF, 0x01, 0]);

        let meta = std::fs::read_to_string(dir.join("meta.json")).unwrap();
        assert!(meta.contains("\"schemaVersion\":1"));
        assert!(meta.contains(&format!("\"bytes\":{}", log.len())));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stamps_mode_resets_when_reopening_over_history() {
        let dir = temp_dir("reopen");
        let mut first = TranscriptRecorder::new(&dir);
        first.open().unwrap();
        first.append(b"hello\n").unwrap();
        first.close().unwrap();

        let mut second = TranscriptRecorder::new(&dir);
        second.open().unwrap();
        second.append(b"world\n").unwrap();
        second.close().unwrap();

        let log = std::fs::read(dir.join("transcript.log")).unwrap();
        let expected = [b"hello\n".as_ref(), TERMINAL_MODE_RESETS.as_bytes(), b"world\n"].concat();
        assert_eq!(log, expected);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn head_truncates_when_over_budget() {
        let dir = temp_dir("trunc");
        let mut rec = TranscriptRecorder::with_limits(&dir, 8, 10);
        rec.open().unwrap();
        rec.append(b"0123456789ABCDEF").unwrap(); // 16 bytes > truncate_at 10
        rec.flush().unwrap();

        let log = std::fs::read(dir.join("transcript.log")).unwrap();
        assert_eq!(log, b"89ABCDEF", "keeps the last max_bytes bytes");

        // Recorder is still usable after truncation.
        rec.append(b"!").unwrap();
        rec.close().unwrap();
        let log = std::fs::read(dir.join("transcript.log")).unwrap();
        assert_eq!(log, b"89ABCDEF!");

        std::fs::remove_dir_all(&dir).ok();
    }
}
