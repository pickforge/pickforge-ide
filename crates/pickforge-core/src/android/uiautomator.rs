//! UIAutomator XML → accessibility tree — ported from
//! `android_uiautomator_parser.dart`. Framework-agnostic (native Views, Compose,
//! React Native all emit the same XML). Tolerant of the status line that
//! `adb exec-out uiautomator dump /dev/tty` prepends and of malformed `bounds`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum A11yRole {
    Button,
    Text,
    Image,
    Input,
    SwitchControl,
    Checkbox,
    List,
    Unknown,
}

/// Device-pixel rectangle `[left,top][right,bottom]`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl Rect {
    pub const ZERO: Rect = Rect { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };

    pub fn is_empty(&self) -> bool {
        self.left >= self.right || self.top >= self.bottom
    }

    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    pub fn expand_to_include(&self, other: &Rect) -> Rect {
        Rect {
            left: self.left.min(other.left),
            top: self.top.min(other.top),
            right: self.right.max(other.right),
            bottom: self.bottom.max(other.bottom),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yNode {
    pub node_id: String,
    pub role: A11yRole,
    pub class_name: String,
    pub text: Option<String>,
    pub content_description: Option<String>,
    pub resource_id: Option<String>,
    pub bounds: Rect,
    pub enabled: bool,
    pub clickable: bool,
    pub selected: bool,
    pub children: Vec<A11yNode>,
}

#[derive(Debug, thiserror::Error)]
pub enum UiAutomatorError {
    #[error("no UIAutomator <node> elements found")]
    NoNodes,
    #[error("xml parse error: {0}")]
    Xml(String),
}

/// Parse `xml` into the root accessibility node.
pub fn parse_uiautomator(xml: &str) -> Result<A11yNode, UiAutomatorError> {
    let doc = roxmltree::Document::parse(extract_xml(xml))
        .map_err(|e| UiAutomatorError::Xml(e.to_string()))?;
    let top: Vec<roxmltree::Node> = doc
        .root_element()
        .children()
        .filter(|n| n.has_tag_name("node"))
        .collect();

    if top.is_empty() {
        return Err(UiAutomatorError::NoNodes);
    }
    if top.len() == 1 {
        return Ok(to_node(&top[0], "0".to_string()));
    }

    // Multiple top-level windows: wrap under a synthetic root whose bounds span
    // every (non-empty) child so hit-testing still reaches the children.
    let children: Vec<A11yNode> = top
        .iter()
        .enumerate()
        .map(|(i, n)| to_node(n, i.to_string()))
        .collect();
    let real: Vec<Rect> = children
        .iter()
        .map(|c| c.bounds)
        .filter(|b| !b.is_empty())
        .collect();
    let mut bounds = real.first().copied().unwrap_or(Rect::ZERO);
    for b in real.iter().skip(1) {
        bounds = bounds.expand_to_include(b);
    }

    Ok(A11yNode {
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
    })
}

/// The deepest, topmost node whose bounds contain `(x, y)`, or `None`.
pub fn hit_test(root: &A11yNode, x: f64, y: f64) -> Option<&A11yNode> {
    if !root.bounds.contains(x, y) {
        return None;
    }
    for child in root.children.iter().rev() {
        if let Some(hit) = hit_test(child, x, y) {
            return Some(hit);
        }
    }
    Some(root)
}

/// Ancestors of `node_id`, ordered root → immediate parent (exclusive of the
/// node itself). Empty when the node is the root or not found.
pub fn ancestor_hierarchy<'a>(root: &'a A11yNode, node_id: &str) -> Vec<&'a A11yNode> {
    fn walk<'a>(node: &'a A11yNode, target: &str, path: &mut Vec<&'a A11yNode>) -> bool {
        if node.node_id == target {
            return true;
        }
        path.push(node);
        for child in &node.children {
            if walk(child, target, path) {
                return true;
            }
        }
        path.pop();
        false
    }

    let mut path = Vec::new();
    if walk(root, node_id, &mut path) {
        path
    } else {
        Vec::new()
    }
}

fn to_node(element: &roxmltree::Node, node_id: String) -> A11yNode {
    let children: Vec<A11yNode> = element
        .children()
        .filter(|c| c.has_tag_name("node"))
        .enumerate()
        .map(|(i, c)| to_node(&c, format!("{node_id}/{i}")))
        .collect();

    let class_name = element.attribute("class").unwrap_or("").to_string();
    A11yNode {
        role: role_for(&class_name),
        text: non_empty(element.attribute("text")),
        content_description: non_empty(element.attribute("content-desc")),
        resource_id: non_empty(element.attribute("resource-id")),
        bounds: parse_bounds(element.attribute("bounds")),
        enabled: element.attribute("enabled") == Some("true"),
        clickable: element.attribute("clickable") == Some("true"),
        selected: element.attribute("selected") == Some("true"),
        class_name,
        node_id,
        children,
    }
}

fn role_for(class_name: &str) -> A11yRole {
    let c = class_name.to_lowercase();
    if c.contains("button") {
        A11yRole::Button
    } else if c.contains("edittext") {
        A11yRole::Input
    } else if c.contains("image") {
        A11yRole::Image
    } else if c.contains("switch") {
        A11yRole::SwitchControl
    } else if c.contains("checkbox") {
        A11yRole::Checkbox
    } else if c.contains("recyclerview") || c.contains("listview") || c.contains("scrollview") {
        A11yRole::List
    } else if c.contains("textview") {
        A11yRole::Text
    } else {
        A11yRole::Unknown
    }
}

fn parse_bounds(raw: Option<&str>) -> Rect {
    let raw = match raw {
        Some(r) => r,
        None => return Rect::ZERO,
    };
    // Expected form `[l,t][r,b]`; pull the first four signed integers.
    let nums: Vec<f64> = raw
        .split(|c: char| !c.is_ascii_digit() && c != '-')
        .filter_map(|s| s.parse::<f64>().ok())
        .collect();
    if nums.len() < 4 {
        return Rect::ZERO;
    }
    Rect { left: nums[0], top: nums[1], right: nums[2], bottom: nums[3] }
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value.filter(|s| !s.is_empty()).map(str::to_string)
}

fn extract_xml(raw: &str) -> &str {
    match (raw.find('<'), raw.rfind('>')) {
        (Some(start), Some(end)) if end >= start => &raw[start..=end],
        _ => raw,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"junk status line
<?xml version='1.0'?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" enabled="true" clickable="false" selected="false">
    <node class="android.widget.Button" text="Login" resource-id="com.app:id/login" bounds="[40,100][520,200]" enabled="true" clickable="true" selected="false"/>
    <node class="android.widget.TextView" content-desc="Title" bounds="[40,220][1040,320]" enabled="true" clickable="false" selected="false"/>
  </node>
</hierarchy>"#;

    #[test]
    fn parses_tree_with_roles_and_ids() {
        let root = parse_uiautomator(XML).unwrap();
        assert_eq!(root.node_id, "0");
        assert_eq!(root.children.len(), 2);

        let button = &root.children[0];
        assert_eq!(button.node_id, "0/0");
        assert_eq!(button.role, A11yRole::Button);
        assert_eq!(button.text.as_deref(), Some("Login"));
        assert_eq!(button.resource_id.as_deref(), Some("com.app:id/login"));
        assert!(button.clickable);

        assert_eq!(root.children[1].role, A11yRole::Text);
        assert_eq!(root.children[1].content_description.as_deref(), Some("Title"));
    }

    #[test]
    fn hit_test_returns_deepest_node() {
        let root = parse_uiautomator(XML).unwrap();
        let hit = hit_test(&root, 100.0, 150.0).unwrap();
        assert_eq!(hit.node_id, "0/0"); // inside the button
        assert!(hit_test(&root, 5000.0, 5000.0).is_none());
    }

    #[test]
    fn ancestors_are_root_to_parent() {
        let root = parse_uiautomator(XML).unwrap();
        let ancestors = ancestor_hierarchy(&root, "0/1");
        assert_eq!(ancestors.len(), 1);
        assert_eq!(ancestors[0].node_id, "0");
    }

    #[test]
    fn errors_when_no_nodes() {
        assert!(matches!(
            parse_uiautomator("<hierarchy></hierarchy>"),
            Err(UiAutomatorError::NoNodes)
        ));
    }

    #[test]
    fn malformed_bounds_fall_back_to_zero() {
        assert_eq!(parse_bounds(Some("garbage")), Rect::ZERO);
        assert_eq!(parse_bounds(None), Rect::ZERO);
        assert_eq!(
            parse_bounds(Some("[-1,2][3,4]")),
            Rect { left: -1.0, top: 2.0, right: 3.0, bottom: 4.0 }
        );
    }
}
