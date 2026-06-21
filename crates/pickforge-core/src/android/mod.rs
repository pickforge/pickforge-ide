//! Android device integration: ADB one-shot ops, logcat parsing, and
//! UIAutomator hierarchy parsing.

mod adb;
mod emulator;
mod logcat;
mod uiautomator;

pub use adb::{
    capture_screenshot, dump_uiautomator_xml, list_devices, running_avd_id, wait_for_online,
    AdbDevice,
};
pub use emulator::{
    device_list, launch_avd, list_avds, resolve_emulator_binary, AvdInfo, DeviceEntry, DeviceKind,
    DeviceState,
};
pub use logcat::{logcat_event, LogEvent, LogLevel};
pub use uiautomator::{
    ancestor_hierarchy, hit_test, parse_uiautomator, A11yNode, A11yRole, Rect, UiAutomatorError,
};
