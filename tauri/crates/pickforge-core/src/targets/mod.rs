//! Target adapters + source resolution. The web source-map resolver lands here;
//! the flutter/RN/native adapters + UIAutomator/source-candidate finders join it
//! with the device bridges.

mod source_map;

pub use source_map::{SourceMap, SourceMapping};
