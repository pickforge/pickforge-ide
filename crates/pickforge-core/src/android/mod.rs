//! Android device integration: ADB one-shot ops, logcat parsing, and
//! UIAutomator hierarchy parsing.

mod adb;
mod logcat;
mod uiautomator;

pub use adb::{capture_screenshot, dump_uiautomator_xml, list_devices, AdbDevice};
pub use logcat::{logcat_event, LogEvent, LogLevel};
pub use uiautomator::{
    ancestor_hierarchy, hit_test, parse_uiautomator, A11yNode, A11yRole, Rect, UiAutomatorError,
};
