//! ANSI SGR parser — ported from `lib/core/terminal/ansi.dart`.
//!
//! Splits a terminal stream into plain text plus a list of styled [`AnsiSpan`]s
//! (offsets are byte offsets into the stripped text). Escape sequences are
//! recognised with a hand-rolled scanner equivalent to the Dart regex, so we
//! don't pull in the `regex` crate.

/// A run of text carrying a non-default style. `fg`/`bg` are ANSI palette
/// indices (0–7 normal, 8–15 bright); `None` means "default".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnsiSpan {
    pub start: usize,
    pub end: usize,
    pub fg: Option<u8>,
    pub bg: Option<u8>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnsiResult {
    pub text: String,
    pub spans: Vec<AnsiSpan>,
}

#[derive(Default, Clone)]
struct Style {
    fg: Option<u8>,
    bg: Option<u8>,
    bold: bool,
    italic: bool,
    underline: bool,
}

impl Style {
    fn has_any(&self) -> bool {
        self.fg.is_some() || self.bg.is_some() || self.bold || self.italic || self.underline
    }
}

/// Parse `input` into plain text + styled spans.
pub fn parse_ansi(input: &str) -> AnsiResult {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut spans: Vec<AnsiSpan> = Vec::new();
    let mut style = Style::default();
    let mut span_start = 0usize;

    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1B {
            if let Some(end) = match_escape(bytes, i) {
                flush(&mut spans, out.len(), &mut span_start, &style);
                let seq = &input[i..end];
                let sb = seq.as_bytes();
                if sb.len() > 2 && sb[1] == b'[' && seq.ends_with('m') {
                    apply_sgr(&seq[2..seq.len() - 1], &mut style);
                }
                i = end;
                continue;
            }
        }
        let len = utf8_len(bytes[i]);
        out.push_str(&input[i..i + len]);
        i += len;
    }
    flush(&mut spans, out.len(), &mut span_start, &style);

    AnsiResult { text: out, spans }
}

/// Remove every escape sequence, returning only the plain text.
pub fn strip_ansi(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1B {
            if let Some(end) = match_escape(bytes, i) {
                i = end;
                continue;
            }
        }
        let len = utf8_len(bytes[i]);
        out.push_str(&input[i..i + len]);
        i += len;
    }
    out
}

fn flush(spans: &mut Vec<AnsiSpan>, out_len: usize, span_start: &mut usize, style: &Style) {
    if out_len > *span_start && style.has_any() {
        spans.push(AnsiSpan {
            start: *span_start,
            end: out_len,
            fg: style.fg,
            bg: style.bg,
            bold: style.bold,
            italic: style.italic,
            underline: style.underline,
        });
    }
    *span_start = out_len;
}

fn apply_sgr(params: &str, style: &mut Style) {
    for part in params.split(';') {
        let p: i32 = if part.is_empty() { 0 } else { part.parse().unwrap_or(0) };
        match p {
            0 => *style = Style::default(),
            1 => style.bold = true,
            3 => style.italic = true,
            4 => style.underline = true,
            22 => style.bold = false,
            23 => style.italic = false,
            24 => style.underline = false,
            30..=37 => style.fg = Some((p - 30) as u8),
            39 => style.fg = None,
            40..=47 => style.bg = Some((p - 40) as u8),
            49 => style.bg = None,
            90..=97 => style.fg = Some((p - 90 + 8) as u8),
            100..=107 => style.bg = Some((p - 100 + 8) as u8),
            _ => {}
        }
    }
}

/// If `b[i]` starts a recognised escape sequence, return the index just past it.
/// Equivalent to the Dart `_ansiRegex` alternation (CSI | OSC | other).
fn match_escape(b: &[u8], i: usize) -> Option<usize> {
    let n = b.len();
    if i + 1 >= n {
        return None;
    }
    match b[i + 1] {
        // CSI: ESC [ params(0x30-3F)* intermediates(0x20-2F)* final(0x40-7E)
        b'[' => {
            let mut j = i + 2;
            while j < n && (0x30..=0x3F).contains(&b[j]) {
                j += 1;
            }
            while j < n && (0x20..=0x2F).contains(&b[j]) {
                j += 1;
            }
            if j < n && (0x40..=0x7E).contains(&b[j]) {
                Some(j + 1)
            } else {
                None
            }
        }
        // OSC: ESC ] … (BEL | ESC \)
        b']' => {
            let mut j = i + 2;
            while j < n {
                if b[j] == 0x07 {
                    return Some(j + 1);
                }
                if b[j] == 0x1B && j + 1 < n && b[j + 1] == b'\\' {
                    return Some(j + 2);
                }
                j += 1;
            }
            None
        }
        // Other: ESC intermediates(0x20-2F)* final(0x30-7E)
        _ => {
            let mut j = i + 1;
            while j < n && (0x20..=0x2F).contains(&b[j]) {
                j += 1;
            }
            if j < n && (0x30..=0x7E).contains(&b[j]) {
                Some(j + 1)
            } else {
                None
            }
        }
    }
}

fn utf8_len(lead: u8) -> usize {
    match lead {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_to_plain_text() {
        let input = "\x1b[31mred\x1b[0m normal";
        assert_eq!(strip_ansi(input), "red normal");
    }

    #[test]
    fn produces_a_span_for_a_colored_run() {
        let r = parse_ansi("\x1b[31mred\x1b[0m tail");
        assert_eq!(r.text, "red tail");
        assert_eq!(r.spans.len(), 1);
        let s = &r.spans[0];
        assert_eq!((s.start, s.end), (0, 3));
        assert_eq!(s.fg, Some(1));
        assert_eq!(s.bg, None);
        assert!(!s.bold);
    }

    #[test]
    fn bright_foreground_and_bold_italic_underline() {
        let r = parse_ansi("\x1b[1;3;4;92mX\x1b[0m");
        assert_eq!(r.text, "X");
        let s = &r.spans[0];
        assert_eq!(s.fg, Some(10)); // 92 -> 2 + 8
        assert!(s.bold && s.italic && s.underline);
    }

    #[test]
    fn background_and_reset_codes() {
        let r = parse_ansi("\x1b[44mB\x1b[49mC");
        // "B" carries bg=4; "C" after 49 (default bg) has no style → 1 span.
        assert_eq!(r.text, "BC");
        assert_eq!(r.spans.len(), 1);
        assert_eq!(r.spans[0].bg, Some(4));
        assert_eq!((r.spans[0].start, r.spans[0].end), (0, 1));
    }

    #[test]
    fn osc_title_sequence_is_stripped() {
        // OSC 0 set-title, BEL terminated.
        let r = parse_ansi("\x1b]0;my title\x07hello");
        assert_eq!(r.text, "hello");
        assert!(r.spans.is_empty());
    }

    #[test]
    fn cursor_move_csi_is_stripped_without_style() {
        let r = parse_ansi("a\x1b[2Kb");
        assert_eq!(r.text, "ab");
        assert!(r.spans.is_empty());
    }

    #[test]
    fn preserves_multibyte_text() {
        let r = parse_ansi("\x1b[32m✓ café\x1b[0m");
        assert_eq!(r.text, "✓ café");
        // span covers the whole utf-8 byte range of the run.
        assert_eq!(r.spans[0].start, 0);
        assert_eq!(r.spans[0].end, "✓ café".len());
        assert_eq!(r.spans[0].fg, Some(2));
    }
}
