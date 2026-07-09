//! Decode a Flutter inspector widget-tree JSON into a [`WidgetNode`] tree —
//! ported from `widget_tree_decoder.dart`. Pure and fixture-testable.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationLocation {
    pub file: String,
    pub line: i64,
    pub column: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetNode {
    pub id: String,
    pub class_name: String,
    pub children: Vec<WidgetNode>,
    pub creation_location: Option<CreationLocation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWidgetNode {
    pub id: String,
    pub class_name: String,
    pub label: Option<String>,
    pub children: Vec<SemanticWidgetNode>,
}

pub fn decode_widget_tree(raw: &Value) -> WidgetNode {
    let children = raw
        .get("children")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().map(decode_widget_tree).collect())
        .unwrap_or_default();

    let creation_location = raw.get("creationLocation").and_then(Value::as_object).map(|o| {
        CreationLocation {
            file: o.get("file").and_then(Value::as_str).unwrap_or("").to_string(),
            line: o.get("line").and_then(Value::as_i64).unwrap_or(0),
            column: o.get("column").and_then(Value::as_i64).unwrap_or(0),
        }
    });

    WidgetNode {
        id: raw.get("valueId").and_then(Value::as_str).unwrap_or("").to_string(),
        class_name: raw
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("<unknown>")
            .to_string(),
        children,
        creation_location,
    }
}

pub fn decode_semantic_widget_tree(raw: &Value) -> SemanticWidgetNode {
    let children = raw
        .get("children")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().map(decode_semantic_widget_tree).collect())
        .unwrap_or_default();
    let class_name = first_string(raw, &["widgetRuntimeType", "type", "runtimeType"])
        .or_else(|| raw.get("description").and_then(Value::as_str))
        .unwrap_or("<unknown>")
        .to_string();
    let label = first_string(raw, &["textPreview"])
        .or_else(|| {
            raw.get("description")
                .and_then(Value::as_str)
                .filter(|description| *description != class_name)
        })
        .map(ToString::to_string);

    SemanticWidgetNode {
        id: raw.get("valueId").and_then(Value::as_str).unwrap_or("").to_string(),
        class_name,
        label,
        children,
    }
}

fn first_string<'a>(raw: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        raw.get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_nested_tree_with_location() {
        let raw = json!({
            "valueId": "root",
            "description": "MyApp",
            "children": [
                {
                    "valueId": "c1",
                    "description": "Scaffold",
                    "creationLocation": { "file": "lib/main.dart", "line": 12, "column": 4 }
                }
            ]
        });
        let node = decode_widget_tree(&raw);
        assert_eq!(node.id, "root");
        assert_eq!(node.class_name, "MyApp");
        assert_eq!(node.children.len(), 1);
        let child = &node.children[0];
        assert_eq!(child.id, "c1");
        assert_eq!(
            child.creation_location.as_ref().unwrap().file,
            "lib/main.dart"
        );
        assert_eq!(child.creation_location.as_ref().unwrap().line, 12);
    }

    #[test]
    fn defaults_missing_fields() {
        let node = decode_widget_tree(&json!({ "valueId": "x" }));
        assert_eq!(node.class_name, "<unknown>");
        assert!(node.children.is_empty());
        assert!(node.creation_location.is_none());
    }

    #[test]
    fn decodes_semantic_tree_without_location_data() {
        let raw: Value =
            serde_json::from_str(include_str!("../fixtures/inspector/root-widget-tree.json"))
                .expect("fixture is valid JSON");

        let node = decode_semantic_widget_tree(&raw);

        assert_eq!(node.class_name, "MaterialApp");
        assert_eq!(node.children[0].class_name, "Text");
        assert_eq!(node.children[0].label.as_deref(), Some("Sign in"));
        assert_eq!(node.children[1].class_name, "LoginButton");
        assert_eq!(node.children[1].label.as_deref(), Some("Continue"));
        assert_eq!(node.children[2].class_name, "TextButton");
        assert_eq!(node.children[2].label.as_deref(), Some("Create account"));
        assert_eq!(node.children[3].class_name, "SummaryOnlyWidget");
        assert!(node.children[3].label.is_none());

        let serialized = serde_json::to_string(&node).expect("semantic tree serializes");
        assert!(!serialized.contains("/Users/example/app/"));
        assert!(!serialized.contains("creationLocation"));
        assert!(!serialized.contains("bounds"));
    }
}
