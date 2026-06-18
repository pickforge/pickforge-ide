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
}
