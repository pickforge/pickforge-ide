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
            // Every delta is checked: a hostile `.map` can encode arbitrarily
            // large VLQ values, so an add that would overflow drops the segment.
            let Some(next_gen) = generated_column.checked_add(fields[0]) else {
                continue;
            };
            generated_column = next_gen;
            if fields.len() >= 4 {
                let (Some(next_src), Some(next_line), Some(next_col)) = (
                    source_index.checked_add(fields[1]),
                    original_line.checked_add(fields[2]),
                    original_column.checked_add(fields[3]),
                ) else {
                    continue;
                };
                source_index = next_src;
                original_line = next_line;
                original_column = next_col;
                let segment_name = if fields.len() >= 5 {
                    match name_index.checked_add(fields[4]) {
                        Some(ni) => {
                            name_index = ni;
                            Some(name_index)
                        }
                        None => continue,
                    }
                } else {
                    None
                };
                segments.push(Segment {
                    generated_column,
                    source_index: Some(source_index),
                    original_line: Some(original_line),
                    original_column: Some(original_column),
                    name_index: segment_name,
                });
            } else {
                segments.push(Segment {
                    generated_column,
                    source_index: None,
                    original_line: None,
                    original_column: None,
                    name_index: None,
                });
            }
        }
        lines.push(segments);
    }
    lines
}

/// Decode one comma-segment of VLQ fields. `None` on an invalid Base64 char, a
/// continuation bit set on the final digit (a truncated VLQ), or a value that
/// overflows i64 — all checked so malformed input degrades to a dropped segment
/// instead of an arithmetic panic.
fn decode_vlq_segment(segment: &str) -> Option<Vec<i64>> {
    let mut values = Vec::new();
    let mut result: i64 = 0;
    let mut shift: u32 = 0;
    for byte in segment.bytes() {
        let digit = base64_index(byte)?;
        let continuation = (digit & 32) != 0;
        // A well-formed VLQ field is at most 32 bits, so a shift past the i64
        // width can only come from a malformed/oversized field — reject it
        // instead of letting the `<<` overflow-panic in debug or wrap silently.
        let chunk = (digit & 31).checked_shl(shift)?;
        result = result.checked_add(chunk)?;
        if continuation {
            shift = shift.checked_add(5)?;
        } else {
            let negative = (result & 1) == 1;
            let magnitude = result >> 1;
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
}
