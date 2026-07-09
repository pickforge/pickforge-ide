use std::fs;
use std::path::Path;

use pickforge_core::operator::OperatorIntent;
use serde_json::{json, Value};

fn fixture_dir(kind: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/operator_intents")
        .join(kind)
}

fn fixture_files(kind: &str) -> Vec<std::path::PathBuf> {
    let mut files = fs::read_dir(fixture_dir(kind))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect::<Vec<_>>();
    files.sort();
    files
}

#[test]
fn valid_operator_intent_fixtures_round_trip() {
    let files = fixture_files("valid");
    assert_eq!(files.len(), 15);

    for path in files {
        let raw = fs::read_to_string(&path).unwrap();
        let intent = OperatorIntent::from_json(&raw).unwrap_or_else(|err| {
            panic!("{} should parse: {err}", path.display());
        });
        let input = serde_json::from_str::<Value>(&raw).unwrap();
        let expected = if path.file_name().is_some_and(|name| name == "omittedOptionals.json") {
            json!({
                "v": 1,
                "id": "intent-omitted-optionals",
                "provenance": "typed",
                "confidence": 0.83,
                "projectRef": null,
                "action": {
                    "action": "openChat",
                    "chat": null,
                },
            })
        } else {
            input
        };
        let output = serde_json::from_str::<Value>(&intent.to_json()).unwrap();
        assert_eq!(output, expected, "{} should round-trip", path.display());
    }
}

#[test]
fn invalid_operator_intent_fixtures_are_rejected() {
    let files = fixture_files("invalid");
    assert!(files.len() >= 16);

    for path in files {
        let raw = fs::read_to_string(&path).unwrap();
        assert!(
            OperatorIntent::from_json(&raw).is_err(),
            "{} should be rejected",
            path.display()
        );
    }
}
