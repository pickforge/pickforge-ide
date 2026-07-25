use serde::{Deserialize, Deserializer};
use serde_json::Value;

use super::{command_failed, run_ios_command, IosError, IOS_TIMEOUT};
use crate::android::{A11yNode, A11yRole, Rect};
use crate::process::is_on_user_path;

const CONTAINMENT_EPSILON: f64 = 0.5;

#[derive(Debug, Deserialize)]
struct IdbElement {
    #[serde(default, deserialize_with = "frame_or_default")]
    frame: IdbFrame,
    #[serde(rename = "AXLabel", default, deserialize_with = "opt_string_lossy")]
    ax_label: Option<String>,
    #[serde(rename = "AXValue", default, deserialize_with = "opt_string_lossy")]
    ax_value: Option<String>,
    #[serde(rename = "AXUniqueId", default, deserialize_with = "opt_string_lossy")]
    ax_unique_id: Option<String>,
    #[serde(rename = "type", default)]
    element_type: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default, deserialize_with = "vec_or_default")]
    custom_actions: Vec<Value>,
}

#[derive(Debug, Default, Clone, Copy, Deserialize)]
struct IdbFrame {
    #[serde(default, deserialize_with = "f64_or_default")]
    x: f64,
    #[serde(default, deserialize_with = "f64_or_default")]
    y: f64,
    #[serde(default, deserialize_with = "f64_or_default")]
    width: f64,
    #[serde(default, deserialize_with = "f64_or_default")]
    height: f64,
}

pub fn parse_idb_accessibility(json: &str) -> Result<A11yNode, IosError> {
    let elements: Vec<IdbElement> =
        serde_json::from_str(json).map_err(|e| IosError::Parse(e.to_string()))?;
    if elements.is_empty() {
        return Err(IosError::Parse("no accessibility elements".to_string()));
    }

    let nodes = elements
        .iter()
        .enumerate()
        .map(|(index, element)| to_node(index, element))
        .collect();
    Ok(build_tree(nodes))
}

pub fn dump_accessibility(udid: &str) -> Result<A11yNode, IosError> {
    if !is_on_user_path("idb") {
        return Err(IosError::MissingDependency(
            "idb not found on PATH; idb is required to inspect iOS accessibility".to_string(),
        ));
    }

    let out = run_ios_command(
        "idb",
        &["ui", "describe-all", "--udid", udid, "--json"],
        IOS_TIMEOUT,
    )?;
    if !out.success() {
        return Err(command_failed("idb", &out));
    }
    parse_idb_accessibility(&out.stdout_utf8())
}

fn to_node(index: usize, element: &IdbElement) -> A11yNode {
    let element_type = element.element_type.as_deref().unwrap_or_default();
    let platform_role = element.role.as_deref().unwrap_or_default();
    let bounds = Rect {
        left: element.frame.x,
        top: element.frame.y,
        right: element.frame.x + element.frame.width,
        bottom: element.frame.y + element.frame.height,
    };

    A11yNode {
        node_id: index.to_string(),
        role: map_role(element_type, platform_role),
        class_name: element_type.to_string(),
        text: non_empty(&element.ax_label).or_else(|| non_empty(&element.ax_value)),
        content_description: None,
        resource_id: non_empty(&element.ax_unique_id),
        bounds,
        enabled: element.enabled.unwrap_or(true),
        clickable: is_button(element_type, platform_role) || !element.custom_actions.is_empty(),
        selected: false,
        children: Vec::new(),
    }
}

fn build_tree(nodes: Vec<A11yNode>) -> A11yNode {
    let mut order: Vec<usize> = (0..nodes.len()).collect();
    order.sort_by(|&a, &b| {
        rect_area(&nodes[b].bounds)
            .total_cmp(&rect_area(&nodes[a].bounds))
            .then_with(|| a.cmp(&b))
    });

    let mut parent = vec![None; nodes.len()];
    for (position, &child_index) in order.iter().enumerate() {
        let child_bounds = nodes[child_index].bounds;
        let mut best_parent = None;
        for &candidate_index in &order[..position] {
            if !rect_contains(&nodes[candidate_index].bounds, &child_bounds) {
                continue;
            }
            if best_parent
                .map(|current| better_parent(candidate_index, current, &nodes))
                .unwrap_or(true)
            {
                best_parent = Some(candidate_index);
            }
        }
        parent[child_index] = best_parent;
    }

    let mut children: Vec<Vec<usize>> = vec![Vec::new(); nodes.len()];
    let mut roots = Vec::new();
    for &index in &order {
        if let Some(parent_index) = parent[index] {
            children[parent_index].push(index);
        } else {
            roots.push(index);
        }
    }

    let mut root_nodes: Vec<A11yNode> = roots
        .iter()
        .map(|&index| materialize(index, &nodes, &children))
        .collect();
    if root_nodes.len() == 1 {
        root_nodes.remove(0)
    } else {
        synthetic_root(root_nodes)
    }
}

fn materialize(index: usize, nodes: &[A11yNode], children: &[Vec<usize>]) -> A11yNode {
    let mut node = nodes[index].clone();
    node.children = children[index]
        .iter()
        .map(|&child_index| materialize(child_index, nodes, children))
        .collect();
    node
}

fn synthetic_root(children: Vec<A11yNode>) -> A11yNode {
    let real: Vec<Rect> = children
        .iter()
        .map(|child| child.bounds)
        .filter(|bounds| !bounds.is_empty())
        .collect();
    let mut bounds = real.first().copied().unwrap_or(Rect::ZERO);
    for child_bounds in real.iter().skip(1) {
        bounds = bounds.expand_to_include(child_bounds);
    }

    A11yNode {
        node_id: "root".to_string(),
        role: A11yRole::Unknown,
        class_name: "hierarchy".to_string(),
        text: None,
        content_description: None,
        resource_id: None,
        bounds,
        enabled: true,
        clickable: false,
        selected: false,
        children,
    }
}

fn rect_contains(parent: &Rect, child: &Rect) -> bool {
    parent.left <= child.left + CONTAINMENT_EPSILON
        && parent.top <= child.top + CONTAINMENT_EPSILON
        && parent.right + CONTAINMENT_EPSILON >= child.right
        && parent.bottom + CONTAINMENT_EPSILON >= child.bottom
}

fn rect_area(rect: &Rect) -> f64 {
    let area = (rect.right - rect.left).max(0.0) * (rect.bottom - rect.top).max(0.0);
    if area.is_finite() {
        area
    } else {
        0.0
    }
}

fn better_parent(candidate_index: usize, current_index: usize, nodes: &[A11yNode]) -> bool {
    let candidate_area = rect_area(&nodes[candidate_index].bounds);
    let current_area = rect_area(&nodes[current_index].bounds);
    if candidate_area + CONTAINMENT_EPSILON < current_area {
        true
    } else if candidate_area > current_area + CONTAINMENT_EPSILON {
        false
    } else {
        candidate_index > current_index
    }
}

fn map_role(element_type: &str, role: &str) -> A11yRole {
    role_for(element_type)
        .or_else(|| role_for(role))
        .unwrap_or(A11yRole::Unknown)
}

fn role_for(value: &str) -> Option<A11yRole> {
    match value.to_ascii_lowercase().as_str() {
        "button" | "axbutton" => Some(A11yRole::Button),
        "statictext" | "axstatictext" => Some(A11yRole::Text),
        "image" | "aximage" => Some(A11yRole::Image),
        "textfield" | "securetextfield" | "searchfield" | "axtextfield" => Some(A11yRole::Input),
        "switch" | "toggle" | "axswitch" => Some(A11yRole::SwitchControl),
        "checkbox" | "axcheckbox" => Some(A11yRole::Checkbox),
        "cell" | "table" | "collectionview" | "axtable" | "axcell" => Some(A11yRole::List),
        _ => None,
    }
}

fn is_button(element_type: &str, role: &str) -> bool {
    matches!(map_role(element_type, role), A11yRole::Button)
}

fn non_empty(value: &Option<String>) -> Option<String> {
    value.as_ref().filter(|s| !s.is_empty()).cloned()
}

fn frame_or_default<'de, D>(deserializer: D) -> Result<IdbFrame, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<IdbFrame>::deserialize(deserializer)?.unwrap_or_default())
}

fn f64_or_default<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<f64>::deserialize(deserializer)?.unwrap_or_default())
}

fn vec_or_default<'de, D>(deserializer: D) -> Result<Vec<Value>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Vec<Value>>::deserialize(deserializer)?.unwrap_or_default())
}

fn opt_string_lossy<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(match Option::<Value>::deserialize(deserializer)? {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value),
        Some(Value::Number(value)) => Some(number_to_string(&value)),
        Some(value) => Some(value.to_string()),
    })
}

fn number_to_string(value: &serde_json::Number) -> String {
    let rendered = value.to_string();
    rendered
        .strip_suffix(".0")
        .unwrap_or(&rendered)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDB_JSON: &str = r#"[
      {
        "frame": {"x": 0, "y": 0, "width": 402, "height": 874},
        "AXLabel": "SampleIosApp",
        "AXUniqueId": null,
        "type": "Application",
        "role": "AXApplication",
        "role_description": "application",
        "AXValue": null,
        "enabled": true,
        "custom_actions": []
      },
      {
        "frame": {"x": 61, "y": 397.8, "width": 280, "height": 33.6},
        "AXLabel": "PickForge iOS Fixture",
        "AXUniqueId": null,
        "type": "StaticText",
        "role": "AXStaticText",
        "role_description": "text",
        "AXValue": null,
        "enabled": true,
        "custom_actions": []
      },
      {
        "frame": {"x": 173.3, "y": 447.6, "width": 55.6, "height": 20.3},
        "AXLabel": "Tap me",
        "AXUniqueId": "fixture-button",
        "type": "Button",
        "role": "AXButton",
        "role_description": "button",
        "AXValue": null,
        "enabled": true,
        "custom_actions": []
      },
      {
        "frame": {"x": 196, "y": 492, "width": 10, "height": 22},
        "AXLabel": null,
        "AXUniqueId": "fixture-counter",
        "type": "StaticText",
        "role": "AXStaticText",
        "role_description": "text",
        "AXValue": "0",
        "enabled": true,
        "custom_actions": []
      }
    ]"#;

    #[test]
    fn parses_realistic_idb_dump_as_tree() {
        let root = parse_idb_accessibility(IDB_JSON).unwrap();

        assert_eq!(root.node_id, "0");
        assert_eq!(root.class_name, "Application");
        assert_eq!(root.text.as_deref(), Some("SampleIosApp"));
        assert_eq!(root.children.len(), 3);

        let title = find_text(&root, "PickForge iOS Fixture").unwrap();
        assert_eq!(title.role, A11yRole::Text);

        let button = find_resource(&root, "fixture-button").unwrap();
        assert_eq!(button.role, A11yRole::Button);
        assert_eq!(button.text.as_deref(), Some("Tap me"));
        assert!(button.content_description.is_none());
        assert_eq!(button.resource_id.as_deref(), Some("fixture-button"));
        assert!(button.clickable);

        let counter = find_resource(&root, "fixture-counter").unwrap();
        assert_eq!(counter.role, A11yRole::Text);
        assert_eq!(counter.text.as_deref(), Some("0"));
        assert_eq!(counter.resource_id.as_deref(), Some("fixture-counter"));
    }

    #[test]
    fn numeric_unique_id_becomes_resource_id() {
        let root = parse_idb_accessibility(
            r#"[
              {
                "frame": {"x": 0, "y": 0, "width": 10, "height": 10},
                "type": "Button",
                "role": "AXButton",
                "AXLabel": "Tap",
                "AXUniqueId": 42
              }
            ]"#,
        )
        .unwrap();

        assert_eq!(root.resource_id.as_deref(), Some("42"));
    }

    #[test]
    fn numeric_value_becomes_text_fallback() {
        let root = parse_idb_accessibility(
            r#"[
              {
                "frame": {"x": 0, "y": 0, "width": 10, "height": 10},
                "type": "StaticText",
                "role": "AXStaticText",
                "AXLabel": null,
                "AXValue": 42.0
              }
            ]"#,
        )
        .unwrap();

        assert_eq!(root.text.as_deref(), Some("42"));
    }

    fn assert_maps_ios_input_and_toggle_roles() {
        assert_eq!(map_role("Button", ""), A11yRole::Button);
        assert_eq!(map_role("", "AXButton"), A11yRole::Button);
        assert_eq!(map_role("StaticText", ""), A11yRole::Text);
        assert_eq!(map_role("Image", ""), A11yRole::Image);
        assert_eq!(map_role("TextField", ""), A11yRole::Input);
        assert_eq!(map_role("SecureTextField", ""), A11yRole::Input);
        assert_eq!(map_role("SearchField", ""), A11yRole::Input);
        assert_eq!(map_role("Switch", ""), A11yRole::SwitchControl);
        assert_eq!(map_role("Toggle", ""), A11yRole::SwitchControl);
    }

    fn assert_maps_ios_list_and_fallback_roles() {
        assert_eq!(map_role("Checkbox", ""), A11yRole::Checkbox);
        assert_eq!(map_role("Cell", ""), A11yRole::List);
        assert_eq!(map_role("Table", ""), A11yRole::List);
        assert_eq!(map_role("CollectionView", ""), A11yRole::List);
        assert_eq!(map_role("Unknown", "AXCell"), A11yRole::List);
        assert_eq!(map_role("Button", "AXStaticText"), A11yRole::Button);
        assert_eq!(map_role("mystery", "AXMystery"), A11yRole::Unknown);
        assert_eq!(map_role("button", ""), A11yRole::Button);
    }

    #[test]
    fn maps_key_ios_roles() {
        assert_maps_ios_input_and_toggle_roles();
        assert_maps_ios_list_and_fallback_roles();
    }

    #[test]
    fn wraps_disjoint_top_level_elements_under_synthetic_root() {
        let root = parse_idb_accessibility(
            r#"[
              {
                "frame": {"x": 0, "y": 0, "width": 10, "height": 10},
                "type": "Button",
                "role": "AXButton",
                "AXLabel": "A"
              },
              {
                "frame": {"x": 20, "y": 30, "width": 5, "height": 6},
                "type": "StaticText",
                "role": "AXStaticText",
                "AXLabel": "B"
              }
            ]"#,
        )
        .unwrap();

        assert_eq!(root.node_id, "root");
        assert_eq!(root.class_name, "hierarchy");
        assert_eq!(root.role, A11yRole::Unknown);
        assert_eq!(
            root.bounds,
            Rect {
                left: 0.0,
                top: 0.0,
                right: 25.0,
                bottom: 36.0
            }
        );
        assert_eq!(root.children.len(), 2);
    }

    #[test]
    fn equal_frame_container_becomes_nearest_parent() {
        let root = parse_idb_accessibility(
            r#"[
              {
                "frame": {"x": 0, "y": 0, "width": 400, "height": 800},
                "type": "Application",
                "role": "AXApplication",
                "AXLabel": "App"
              },
              {
                "frame": {"x": 0, "y": 0, "width": 400, "height": 800},
                "type": "Group",
                "role": "AXGroup"
              },
              {
                "frame": {"x": 40, "y": 80, "width": 100, "height": 30},
                "type": "StaticText",
                "role": "AXStaticText",
                "AXLabel": "Title"
              },
              {
                "frame": {"x": 40, "y": 140, "width": 120, "height": 44},
                "type": "Button",
                "role": "AXButton",
                "AXLabel": "Tap"
              }
            ]"#,
        )
        .unwrap();

        assert_eq!(root.node_id, "0");
        assert_eq!(root.class_name, "Application");
        assert_eq!(root.children.len(), 1);

        let group = &root.children[0];
        assert_eq!(group.node_id, "1");
        assert_eq!(group.class_name, "Group");
        assert_eq!(group.children.len(), 2);
        assert!(group
            .children
            .iter()
            .any(|child| child.node_id == "2" && child.role == A11yRole::Text));
        assert!(group
            .children
            .iter()
            .any(|child| child.node_id == "3" && child.role == A11yRole::Button));
    }

    #[test]
    fn empty_array_errors() {
        assert!(matches!(
            parse_idb_accessibility("[]"),
            Err(IosError::Parse(message)) if message == "no accessibility elements"
        ));
    }

    fn find_resource<'a>(node: &'a A11yNode, resource_id: &str) -> Option<&'a A11yNode> {
        if node.resource_id.as_deref() == Some(resource_id) {
            return Some(node);
        }
        node.children
            .iter()
            .find_map(|child| find_resource(child, resource_id))
    }

    fn find_text<'a>(node: &'a A11yNode, text: &str) -> Option<&'a A11yNode> {
        if node.text.as_deref() == Some(text) {
            return Some(node);
        }
        node.children
            .iter()
            .find_map(|child| find_text(child, text))
    }
}
