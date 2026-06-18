//! Target adapters + source resolution. Detection of the project's target
//! (flutter/RN/native-android/web/generic) and the web source-map resolver.

mod adapters;
mod source_map;

pub use adapters::{detect_target, Capability, Confidence, TargetDetection};
pub use source_map::{SourceMap, SourceMapping};
