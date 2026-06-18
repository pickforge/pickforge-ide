//! Terminal transcript record/replay + ANSI span parsing. Ports
//! `lib/core/terminal/{ansi,transcript_recorder,transcript_replayer}.dart`.

mod ansi;
mod recorder;
mod replayer;

pub use ansi::{parse_ansi, strip_ansi, AnsiResult, AnsiSpan};
pub use recorder::{TranscriptRecorder, TERMINAL_MODE_RESETS};
pub use replayer::TranscriptReplayer;
