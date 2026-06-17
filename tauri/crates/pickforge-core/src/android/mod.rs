//! Android device integration: UIAutomator parsing now; ADB service + logcat
//! parsing join it with the device bridges.

mod uiautomator;

pub use uiautomator::{
    ancestor_hierarchy, hit_test, parse_uiautomator, A11yNode, A11yRole, Rect, UiAutomatorError,
};
