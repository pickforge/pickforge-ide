//! Source Map v3 (Base64-VLQ) decoder — ported from `source_map_resolver.dart`.
//! Pure + fixture-testable: parses the `.map` JSON a CDP/Metro session fetches,
//! answering generated → original position queries. No network.

use serde::Serialize;
use serde_json::Value;

/// An original source position recovered from a generated position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMapping {
    pub source: String,
    pub line: i64,
    pub column: i64,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Segment {
    generated_column: i64,
    source_index: Option<i64>,
    original_line: Option<i64>,
    original_column: Option<i64>,
    name_index: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct SourceMap {
    pub sources: Vec<String>,
    pub names: Vec<String>,
    pub source_root: Option<String>,
    lines: Vec<Vec<Segment>>,
}

impl SourceMap {
    /// Parse `json`; `None` on malformed JSON or a non-object payload.
    pub fn parse(json: &str) -> Option<SourceMap> {
        let value: Value = serde_json::from_str(json).ok()?;
        let obj = value.as_object()?;

        let sources = string_list(obj.get("sources"));
        let names = string_list(obj.get("names"));
        let source_root = obj
            .get("sourceRoot")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let lines = obj
            .get("mappings")
            .and_then(Value::as_str)
            .map(decode_mappings)
            .unwrap_or_default();

        Some(SourceMap { sources, names, source_root, lines })
    }

    /// Original position for a zero-based generated `line`/`column`, snapping to
    /// the nearest mapped segment at or before `column`. `None` when unmapped or
    /// when the segment's `source_index` is out of range.
    pub fn original_position_for(&self, line: i64, column: i64) -> Option<SourceMapping> {
        if line < 0 || line as usize >= self.lines.len() {
            return None;
        }
        let segments = &self.lines[line as usize];

        let mut best: Option<&Segment> = None;
        for segment in segments {
            if segment.generated_column > column {
                break;
            }
            best = Some(segment);
        }
        let best = best?;
        let source_index = best.source_index?;
        if source_index < 0 || source_index as usize >= self.sources.len() {
            return None;
        }

        let name = match best.name_index {
            Some(ni) if ni >= 0 && (ni as usize) < self.names.len() => {
                Some(self.names[ni as usize].clone())
            }
            _ => None,
        };
        Some(SourceMapping {
            source: self.sources[source_index as usize].clone(),
            line: best.original_line.unwrap_or(0),
            column: best.original_column.unwrap_or(0),
            name,
        })
    }

    /// `source` joined with `sourceRoot` (slash-separated), or unchanged.
    pub fn resolve_source(&self, source: &str) -> String {
        match &self.source_root {
            None => source.to_string(),
            Some(root) if root.ends_with('/') => format!("{root}{source}"),
            Some(root) => format!("{root}/{source}"),
        }
    }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value.and_then(Value::as_array) {
        Some(arr) => arr
            .iter()
            .map(|e| match e {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .collect(),
        None => Vec::new(),
    }
}

fn decode_mappings(mappings: &str) -> Vec<Vec<Segment>> {
    let mut lines = Vec::new();
    let mut source_index: i64 = 0;
    let mut original_line: i64 = 0;
    let mut original_column: i64 = 0;
    let mut name_index: i64 = 0;

    for line_group in mappings.split(';') {
        let mut segments = Vec::new();
        let mut generated_column: i64 = 0;
        for raw in line_group.split(',') {
            if raw.is_empty() {
                continue;
            }
            let fields = match decode_vlq_segment(raw) {
                Some(f) if !f.is_empty() => f,
                // A malformed segment (bad Base64, truncated VLQ, or a delta that
                // overflows i64) is dropped rather than panicking — the running
                // source map degrades to "no mapping here", not a crash.
                _ => continue,
            };
            // Decode every field into LOCALS first; a hostile `.map` can encode
            // arbitrarily large VLQ values, so any add that overflows drops the
            // whole segment. Nothing touches the running deltas until the entire
            // segment validates — a rejected segment must not shift the positions
            // of the valid mappings that follow it on this line.
            let Some(next_gen) = generated_column.checked_add(fields[0]) else {
                continue;
            };
            let segment = if fields.len() >= 4 {
                let (Some(next_src), Some(next_line), Some(next_col)) = (
                    source_index.checked_add(fields[1]),
                    original_line.checked_add(fields[2]),
                    original_column.checked_add(fields[3]),
                ) else {
                    continue;
                };
                let next_name = if fields.len() >= 5 {
                    match name_index.checked_add(fields[4]) {
                        Some(ni) => Some(ni),
                        None => continue,
                    }
                } else {
                    None
                };
                // All checked fields succeeded — commit the running state now.
                generated_column = next_gen;
                source_index = next_src;
                original_line = next_line;
                original_column = next_col;
                if let Some(ni) = next_name {
                    name_index = ni;
                }
                Segment {
                    generated_column,
                    source_index: Some(source_index),
                    original_line: Some(original_line),
                    original_column: Some(original_column),
                    name_index: next_name,
                }
            } else {
                generated_column = next_gen;
                Segment {
                    generated_column,
                    source_index: None,
                    original_line: None,
                    original_column: None,
                    name_index: None,
                }
            };
            segments.push(segment);
        }
        lines.push(segments);
    }
    lines
}

/// Decode one comma-segment of VLQ fields. `None` on an invalid Base64 char, a
/// continuation bit set on the final digit (a truncated VLQ), or a field whose
/// magnitude won't fit in `i64` — all checked so malformed input degrades to a
/// dropped segment instead of an arithmetic panic or a silently-wrong delta.
///
/// The accumulator is UNSIGNED and wide (`u128`): shifting a 5-bit chunk into a
/// signed `i64` can set the sign bit, and `i64::checked_shl` only guards
/// `shift >= 64`, not overflow into bit 63 — so an oversized field could decode
/// to a bogus *negative* delta. Accumulating unsigned and bounding the
/// zig-zagged magnitude to `i64::MAX` before applying the sign rejects that
/// (and any wider-than-i64 field) instead of wrapping it.
fn decode_vlq_segment(segment: &str) -> Option<Vec<i64>> {
    let mut values = Vec::new();
    let mut result: u128 = 0;
    let mut shift: u32 = 0;
    for byte in segment.bytes() {
        let digit = base64_index(byte)?;
        let continuation = (digit & 32) != 0;
        // A chunk shifted past the u128 width, or one that overflows the running
        // accumulator, can only come from a malformed/oversized field — reject
        // instead of letting it wrap (a wrong delta) or panic.
        let chunk = ((digit & 31) as u128).checked_shl(shift)?;
        result = result.checked_add(chunk)?;
        if continuation {
            shift = shift.checked_add(5)?;
        } else {
            // Zig-zag: bit 0 is the sign, the rest the magnitude. The magnitude
            // must fit in `i64` so the negation can't overflow — a hostile field
            // wider than i64 is rejected here, not wrapped to a bogus negative.
            let negative = (result & 1) == 1;
            let magnitude = result >> 1;
            if magnitude > i64::MAX as u128 {
                return None;
            }
            let magnitude = magnitude as i64;
            values.push(if negative { -magnitude } else { magnitude });
            result = 0;
            shift = 0;
        }
    }
    if shift != 0 {
        return None;
    }
    Some(values)
}

fn base64_index(c: u8) -> Option<i64> {
    match c {
        b'A'..=b'Z' => Some((c - b'A') as i64),
        b'a'..=b'z' => Some((c - b'a') as i64 + 26),
        b'0'..=b'9' => Some((c - b'0') as i64 + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base64-VLQ-encode a single signed field (zig-zag, little-endian 5-bit
    /// groups) — the inverse of `decode_vlq_segment`, for building fixtures that
    /// need exact (and deliberately oversized) deltas.
    fn encode_vlq(value: i64) -> String {
        const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut v: u64 = if value < 0 {
            ((value.unsigned_abs()) << 1) | 1
        } else {
            (value as u64) << 1
        };
        let mut out = String::new();
        loop {
            let mut digit = (v & 31) as usize;
            v >>= 5;
            if v != 0 {
                digit |= 32; // continuation bit
            }
            out.push(B64[digit] as char);
            if v == 0 {
                break;
            }
        }
        out
    }

    /// A comma-joined segment from its raw signed field deltas.
    fn seg(fields: &[i64]) -> String {
        fields.iter().map(|&f| encode_vlq(f)).collect::<String>()
    }

    #[test]
    fn parses_and_resolves_positions() {
        let json = r#"{"version":3,"sources":["foo.ts"],"names":["x"],"mappings":"AAAA,CAAC"}"#;
        let map = SourceMap::parse(json).unwrap();
        assert_eq!(map.sources, vec!["foo.ts"]);

        // First segment maps generated col 0 → original (0,0).
        let a = map.original_position_for(0, 0).unwrap();
        assert_eq!((a.source.as_str(), a.line, a.column), ("foo.ts", 0, 0));

        // Second segment is at generated col 1 → original (0,1); col 1 snaps to it.
        let b = map.original_position_for(0, 1).unwrap();
        assert_eq!((b.line, b.column), (0, 1));
    }

    #[test]
    fn returns_none_for_unmapped_and_bad_json() {
        assert!(SourceMap::parse("not json").is_none());
        assert!(SourceMap::parse("[]").is_none());
        let map = SourceMap::parse(r#"{"sources":[],"names":[],"mappings":""}"#).unwrap();
        assert!(map.original_position_for(0, 0).is_none());
        assert!(map.original_position_for(5, 0).is_none());
    }

    #[test]
    fn resolves_source_with_root() {
        let map = SourceMap::parse(
            r#"{"sources":["a.js"],"names":[],"sourceRoot":"src","mappings":""}"#,
        )
        .unwrap();
        assert_eq!(map.resolve_source("a.js"), "src/a.js");
        let map2 =
            SourceMap::parse(r#"{"sources":["a.js"],"names":[],"mappings":""}"#).unwrap();
        assert_eq!(map2.resolve_source("a.js"), "a.js");
    }

    // A multi-line, 5-field mapping must decode end to end so the hardening
    // didn't break the happy path: the `name` field (delta-coded) resolves too.
    #[test]
    fn decodes_a_multi_segment_named_mapping() {
        // gen-line0 `AACAA` = [0,0,1,0,0] → foo.ts (1,0) name "x";
        // gen-line1 `AAEI`  = [0,0,2,4]   → foo.ts (1+2, 4) = (3,4).
        let json = r#"{"version":3,"sources":["foo.ts"],"names":["x"],"mappings":"AACAA;AAEI"}"#;
        let map = SourceMap::parse(json).unwrap();
        let a = map.original_position_for(0, 0).unwrap();
        assert_eq!((a.source.as_str(), a.line, a.column), ("foo.ts", 1, 0));
        assert_eq!(a.name.as_deref(), Some("x"));
        let b = map.original_position_for(1, 0).unwrap();
        assert_eq!((b.line, b.column), (3, 4));
    }

    // A `.map` is untrusted input — malformed Base64-VLQ must never panic. Each
    // case exercises a distinct hardening path; parsing must succeed and the
    // bad segment simply yields no mapping.
    #[test]
    fn malformed_vlq_does_not_panic() {
        // '$' / '!' / '=' are outside the Base64 alphabet → segment dropped.
        for bad in ["{\"sources\":[\"a.js\"],\"names\":[],\"mappings\":\"$$$$\"}",
            "{\"sources\":[\"a.js\"],\"names\":[],\"mappings\":\"A!A\"}",
            // Continuation bit set on the final digit (truncated VLQ): 'g' = 32.
            "{\"sources\":[\"a.js\"],\"names\":[],\"mappings\":\"g\"}"]
        {
            let map = SourceMap::parse(bad).expect("parse must not fail on a bad segment");
            assert!(map.original_position_for(0, 0).is_none());
        }
    }

    // An adversarial `.map` can encode a VLQ far wider than i64; the checked
    // shift/add must drop it instead of overflow-panicking. A long run of
    // continuation digits ('g' = value 0, continuation bit set) pushes `shift`
    // past 63 and would panic on `<<` without the guard.
    #[test]
    fn oversized_vlq_is_rejected_without_panic() {
        let huge = "g".repeat(64); // 64 continuation digits, no terminator
        let json = format!(
            r#"{{"sources":["a.js"],"names":[],"mappings":"{huge}"}}"#
        );
        let map = SourceMap::parse(&json).expect("parse must not panic on an oversized VLQ");
        assert!(map.original_position_for(0, 0).is_none());

        // Direct unit check on the segment decoder: oversized → None, not panic.
        assert!(super::decode_vlq_segment(&"g".repeat(64)).is_none());
        // A valid single field ('B' = +0 after zig-zag of value 1 → actually
        // decodes; assert it returns Some so the guard didn't over-reject).
        assert!(super::decode_vlq_segment("A").is_some());
    }

    // Regression for the sign-bit overflow: a VLQ field can be ≤ 64 bits wide
    // (so the old `shift >= 64`-only guard accepted it) yet carry a magnitude
    // past `i64::MAX`. The old signed accumulator wrapped it into the sign bit
    // and emitted a bogus *negative* delta; the unsigned-accumulate + magnitude
    // bound must reject it instead.
    #[test]
    fn high_bit_vlq_field_is_rejected_not_negative() {
        // 12 continuation zeros ('g' = value 0, cont. bit set) push shift to 60,
        // then a final 'Q' (value 16, no continuation) places a set bit at
        // position 64 → magnitude = 1<<63 > i64::MAX. Must decode to None.
        let field = format!("{}Q", "g".repeat(12));
        assert!(
            super::decode_vlq_segment(&field).is_none(),
            "a >i64 VLQ field must be rejected, not wrapped negative"
        );

        // And through the public API: the bad segment is dropped, never paints a
        // negative generated column / source delta over the running state.
        let json = format!(
            r#"{{"sources":["a.js"],"names":[],"mappings":"{field}"}}"#
        );
        let map = SourceMap::parse(&json).expect("parse must not panic");
        assert!(map.original_position_for(0, 0).is_none());

        // A field that sets exactly bit 63 ('I' = value 8 at shift 60 → 1<<63)
        // is in range after the zig-zag (magnitude 1<<62) and must decode to a
        // *positive* delta — the old signed shift produced i64::MIN here.
        let signbit = format!("{}I", "g".repeat(12));
        assert_eq!(super::decode_vlq_segment(&signbit), Some(vec![1i64 << 62]));
    }

    // A segment whose VLQ fields all decode but whose running-delta add overflows
    // must be rejected ATOMICALLY: the running state (generated_column, source,
    // line, column, name) may not advance from it, or every later valid mapping
    // on the line is shifted. Here the middle segment carries a valid generated
    // delta but an `original_column` delta that overflows i64 — under the old
    // "commit generated_column first" code it still bumped the column counter and
    // misplaced the segment that follows.
    #[test]
    fn rejected_segment_does_not_shift_following_mappings() {
        // segA: gen=5, src=0, line=0, col=10 → valid mapping at gen col 5.
        let a = seg(&[5, 0, 0, 10]);
        // segBad: gen delta=3 (valid on its own), then col delta = i64::MAX which
        // overflows the running original_column (already 10). Whole segment must
        // be dropped without advancing generated_column.
        let bad = seg(&[3, 0, 0, i64::MAX]);
        // segC: gen delta=2 → must land at col 5+2 = 7 (NOT 5+3+2 = 10).
        let c = seg(&[2, 0, 0, 4]);
        let mappings = format!("{a},{bad},{c}");
        let json = format!(
            r#"{{"sources":["a.js","b.js"],"names":[],"mappings":"{mappings}"}}"#
        );
        let map = SourceMap::parse(&json).expect("parse must not panic");

        // The first valid mapping is intact.
        let at5 = map.original_position_for(0, 5).unwrap();
        assert_eq!((at5.line, at5.column), (0, 10));

        // The mapping after the rejected segment lands at generated col 7 — the
        // rejected segment did NOT bump the running generated column to 8.
        let at7 = map.original_position_for(0, 7).unwrap();
        assert_eq!(at7.column, 14, "col delta from a clean base (10+4), not 10+max");
        // col 6 still snaps to the col-5 mapping; the bad segment left no row at 8.
        assert_eq!(map.original_position_for(0, 6).unwrap().column, 10);
    }
}
