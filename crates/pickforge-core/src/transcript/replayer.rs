//! Replay a recorded transcript by streaming `transcript.log` in chunks —
//! ported from `transcript_replayer.dart`. Spans are UI decoration only and are
//! not needed to reconstruct the terminal, so replay reads the raw log.

use std::path::PathBuf;

const DEFAULT_CHUNK: usize = 64 * 1024;

pub struct TranscriptReplayer {
    dir: PathBuf,
    chunk_bytes: usize,
}

impl TranscriptReplayer {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            chunk_bytes: DEFAULT_CHUNK,
        }
    }

    pub fn with_chunk(dir: impl Into<PathBuf>, chunk_bytes: usize) -> Self {
        Self {
            dir: dir.into(),
            chunk_bytes: chunk_bytes.max(1),
        }
    }

    /// Read the whole log, or `None` if there is no transcript yet.
    pub fn read_log(&self) -> std::io::Result<Option<Vec<u8>>> {
        match std::fs::read(self.dir.join("transcript.log")) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Stream the log to `sink`, one chunk at a time (for feeding xterm.write).
    pub fn for_each_chunk(&self, mut sink: impl FnMut(&[u8])) -> std::io::Result<()> {
        if let Some(bytes) = self.read_log()? {
            for chunk in bytes.chunks(self.chunk_bytes) {
                sink(chunk);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::TranscriptRecorder;

    #[test]
    fn replays_recorded_log_in_chunks() {
        let dir = std::env::temp_dir().join(format!("pf-replay-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let mut rec = TranscriptRecorder::new(&dir);
        rec.open().unwrap();
        rec.append(b"abcdefghij").unwrap();
        rec.close().unwrap();

        let replayer = TranscriptReplayer::with_chunk(&dir, 4);
        let mut chunks: Vec<Vec<u8>> = Vec::new();
        replayer
            .for_each_chunk(|c| chunks.push(c.to_vec()))
            .unwrap();
        assert_eq!(chunks, vec![b"abcd".to_vec(), b"efgh".to_vec(), b"ij".to_vec()]);

        // Missing transcript replays nothing, not an error.
        let empty = TranscriptReplayer::new(dir.join("nope"));
        assert!(empty.read_log().unwrap().is_none());

        std::fs::remove_dir_all(&dir).ok();
    }
}
