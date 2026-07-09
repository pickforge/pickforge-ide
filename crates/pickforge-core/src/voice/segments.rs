//! WAV segment math for voice dictation.
//!
//! Segment ranges keep both an overlap-inclusive `start_sample` and the
//! non-overlap `content_start_sample`. The session writer uses
//! `for_transcription()` before invoking STT, so boundary overlap can guide
//! slicing decisions without duplicating leading words in appended transcripts.

use std::path::Path;
use std::time::Duration;

use super::{write_private_file, VoiceError};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const TARGET_CHANNELS: u16 = 1;
pub const TARGET_BITS_PER_SAMPLE: u16 = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WavData {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Vec<i16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SegmentConfig {
    pub target: Duration,
    pub max: Duration,
    pub overlap: Duration,
    pub search_before: Duration,
    pub energy_window: Duration,
}

impl Default for SegmentConfig {
    fn default() -> Self {
        Self {
            target: Duration::from_secs(5),
            max: Duration::from_secs(10),
            overlap: Duration::from_millis(1500),
            search_before: Duration::from_secs(1),
            energy_window: Duration::from_millis(100),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SegmentRange {
    pub start_sample: usize,
    pub end_sample: usize,
    pub content_start_sample: usize,
}

impl SegmentRange {
    pub fn for_transcription(self) -> Self {
        Self {
            start_sample: self.content_start_sample.max(self.start_sample),
            ..self
        }
    }
}

#[derive(Debug, Clone)]
pub struct Segmenter {
    config: SegmentConfig,
    cursor_sample: usize,
}

impl Segmenter {
    pub fn new(config: SegmentConfig) -> Self {
        Self {
            config,
            cursor_sample: 0,
        }
    }

    pub fn next_range(&mut self, samples: &[i16], sample_rate: u32) -> Option<SegmentRange> {
        let target = duration_samples(self.config.target, sample_rate);
        let max = duration_samples(self.config.max, sample_rate).max(target);
        if samples.len().saturating_sub(self.cursor_sample) < target {
            return None;
        }

        let preferred = self.cursor_sample.saturating_add(target).min(samples.len());
        let forced_end = self.cursor_sample.saturating_add(max).min(samples.len());
        let search_start = self
            .cursor_sample
            .saturating_add(target.saturating_sub(duration_samples(
                self.config.search_before,
                sample_rate,
            )));
        let boundary = low_energy_boundary(
            samples,
            self.cursor_sample,
            search_start.min(preferred),
            forced_end,
            preferred,
            self.config.energy_window,
            sample_rate,
        )
        .unwrap_or(preferred);
        let end_sample = boundary.max(self.cursor_sample + 1).min(forced_end);
        let overlap = duration_samples(self.config.overlap, sample_rate);
        let start_sample = self.cursor_sample.saturating_sub(overlap);
        let range = SegmentRange {
            start_sample,
            end_sample,
            content_start_sample: self.cursor_sample,
        };
        self.cursor_sample = end_sample;
        Some(range)
    }

    pub fn remaining_range(
        &self,
        samples_len: usize,
        sample_rate: u32,
    ) -> Option<SegmentRange> {
        if samples_len <= self.cursor_sample {
            return None;
        }
        let min_tail = sample_rate as usize / 2;
        if samples_len - self.cursor_sample < min_tail {
            return None;
        }
        let overlap = duration_samples(self.config.overlap, sample_rate);
        Some(SegmentRange {
            start_sample: self.cursor_sample.saturating_sub(overlap),
            end_sample: samples_len,
            content_start_sample: self.cursor_sample,
        })
    }
}

pub fn read_wav_file(path: &Path) -> Result<WavData, VoiceError> {
    let bytes = std::fs::read(path)?;
    parse_wav_pcm16(&bytes).map_err(VoiceError::Wav)
}

pub fn write_segment_wav(
    wav: &WavData,
    range: SegmentRange,
    path: &Path,
) -> Result<(), VoiceError> {
    let end = range.end_sample.min(wav.samples.len());
    let start = range.start_sample.min(end);
    let bytes = encode_wav_pcm16_mono(&wav.samples[start..end], wav.sample_rate);
    write_private_file(path, &bytes)?;
    Ok(())
}

pub fn parse_wav_pcm16(bytes: &[u8]) -> Result<WavData, String> {
    if bytes.len() < 44 {
        return Err("wav header is incomplete".to_string());
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("expected RIFF/WAVE header".to_string());
    }

    let mut offset = 12usize;
    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    let mut data: Option<&[u8]> = None;

    while offset.saturating_add(8) <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let declared_len = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let start = offset + 8;
        let declared_end = start.saturating_add(declared_len);
        let open_ended = declared_len == 0 || declared_end > bytes.len();
        let end = if open_ended {
            bytes.len()
        } else {
            declared_end
        };

        match id {
            b"fmt " => {
                if end.saturating_sub(start) < 16 {
                    return Err("fmt chunk is incomplete".to_string());
                }
                let audio_format = u16::from_le_bytes([bytes[start], bytes[start + 1]]);
                let channels = u16::from_le_bytes([bytes[start + 2], bytes[start + 3]]);
                let sample_rate = u32::from_le_bytes([
                    bytes[start + 4],
                    bytes[start + 5],
                    bytes[start + 6],
                    bytes[start + 7],
                ]);
                let bits_per_sample =
                    u16::from_le_bytes([bytes[start + 14], bytes[start + 15]]);
                fmt = Some((audio_format, channels, sample_rate, bits_per_sample));
            }
            b"data" => {
                data = Some(&bytes[start..end]);
                if open_ended {
                    break;
                }
            }
            _ => {}
        }

        let padded = declared_len + (declared_len % 2);
        let next = start.saturating_add(padded);
        if next <= offset || next > bytes.len() {
            break;
        }
        offset = next;
    }

    let (audio_format, channels, sample_rate, bits_per_sample) =
        fmt.ok_or_else(|| "missing fmt chunk".to_string())?;
    if audio_format != 1 {
        return Err("only PCM wav is supported".to_string());
    }
    if channels != TARGET_CHANNELS {
        return Err(format!("expected mono wav, got {channels} channels"));
    }
    if bits_per_sample != TARGET_BITS_PER_SAMPLE {
        return Err(format!("expected 16-bit wav, got {bits_per_sample}-bit"));
    }

    let data = data.ok_or_else(|| "missing data chunk".to_string())?;
    let mut samples = Vec::with_capacity(data.len() / 2);
    for chunk in data.chunks_exact(2) {
        samples.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }

    Ok(WavData {
        sample_rate,
        channels,
        samples,
    })
}

pub fn encode_wav_pcm16_mono(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let riff_len = 36 + data_len;
    let byte_rate = sample_rate * TARGET_CHANNELS as u32 * TARGET_BITS_PER_SAMPLE as u32 / 8;
    let block_align = TARGET_CHANNELS * TARGET_BITS_PER_SAMPLE / 8;
    let mut out = Vec::with_capacity(44 + data_len);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff_len as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&TARGET_CHANNELS.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&TARGET_BITS_PER_SAMPLE.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

pub fn rms_level(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum = samples
        .iter()
        .map(|sample| {
            let v = *sample as f32 / i16::MAX as f32;
            v * v
        })
        .sum::<f32>();
    (sum / samples.len() as f32).sqrt().clamp(0.0, 1.0)
}

fn low_energy_boundary(
    samples: &[i16],
    content_start: usize,
    search_start: usize,
    search_end: usize,
    preferred: usize,
    window: Duration,
    sample_rate: u32,
) -> Option<usize> {
    if search_start >= search_end || samples.is_empty() {
        return None;
    }
    let window_samples = duration_samples(window, sample_rate).max(1);
    let step = (sample_rate as usize / 20).max(1);
    let baseline_end = preferred.min(samples.len()).max(content_start + 1);
    let baseline = mean_abs(&samples[content_start.min(samples.len())..baseline_end]);
    let mut best = preferred.min(search_end);
    let mut best_energy = mean_abs_window(samples, best, window_samples);
    let mut cursor = search_start;
    while cursor <= search_end {
        let energy = mean_abs_window(samples, cursor, window_samples);
        if energy < best_energy {
            best = cursor;
            best_energy = energy;
        }
        cursor = cursor.saturating_add(step);
        if cursor == usize::MAX {
            break;
        }
    }
    if best_energy <= baseline * 0.25 || best_energy <= 256.0 {
        Some(best)
    } else {
        Some(preferred.min(search_end))
    }
}

fn mean_abs_window(samples: &[i16], center: usize, window: usize) -> f32 {
    let half = window / 2;
    let start = center.saturating_sub(half).min(samples.len());
    let end = center.saturating_add(half).min(samples.len());
    mean_abs(&samples[start..end])
}

fn mean_abs(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    samples
        .iter()
        .map(|sample| sample.unsigned_abs() as f32)
        .sum::<f32>()
        / samples.len() as f32
}

fn duration_samples(duration: Duration, sample_rate: u32) -> usize {
    ((duration.as_secs_f64() * sample_rate as f64).round() as usize).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seconds(seconds: f32, value: i16) -> Vec<i16> {
        vec![value; (seconds * TARGET_SAMPLE_RATE as f32) as usize]
    }

    #[test]
    fn parses_and_encodes_synthetic_wav() {
        let samples = seconds(1.0, 1200);
        let bytes = encode_wav_pcm16_mono(&samples, TARGET_SAMPLE_RATE);
        let wav = parse_wav_pcm16(&bytes).unwrap();
        assert_eq!(wav.sample_rate, TARGET_SAMPLE_RATE);
        assert_eq!(wav.channels, TARGET_CHANNELS);
        assert_eq!(wav.samples, samples);
    }

    #[test]
    fn zero_length_data_chunk_extends_to_eof_without_scanning_pcm_as_chunks() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&TARGET_CHANNELS.to_le_bytes());
        bytes.extend_from_slice(&TARGET_SAMPLE_RATE.to_le_bytes());
        let byte_rate =
            TARGET_SAMPLE_RATE * TARGET_CHANNELS as u32 * TARGET_BITS_PER_SAMPLE as u32 / 8;
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        let block_align = TARGET_CHANNELS * TARGET_BITS_PER_SAMPLE / 8;
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&TARGET_BITS_PER_SAMPLE.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&3u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&48_000u32.to_le_bytes());
        bytes.extend_from_slice(&192_000u32.to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&32u16.to_le_bytes());

        let wav = parse_wav_pcm16(&bytes).unwrap();

        assert_eq!(wav.sample_rate, TARGET_SAMPLE_RATE);
        assert_eq!(wav.channels, TARGET_CHANNELS);
        assert_eq!(wav.samples.len(), 12);
    }

    #[test]
    fn selects_low_energy_boundary_near_target() {
        let mut samples = seconds(5.2, 10_000);
        samples.extend(seconds(0.35, 0));
        samples.extend(seconds(1.0, 10_000));

        let mut segmenter = Segmenter::new(SegmentConfig::default());
        let range = segmenter.next_range(&samples, TARGET_SAMPLE_RATE).unwrap();
        let end_seconds = range.end_sample as f32 / TARGET_SAMPLE_RATE as f32;

        assert!((5.15..=5.55).contains(&end_seconds), "end at {end_seconds}");
    }

    #[test]
    fn overlap_starts_next_segment_before_previous_end() {
        let samples = seconds(12.0, 10_000);
        let mut segmenter = Segmenter::new(SegmentConfig::default());
        let first = segmenter.next_range(&samples, TARGET_SAMPLE_RATE).unwrap();
        let second = segmenter.next_range(&samples, TARGET_SAMPLE_RATE).unwrap();
        let overlap =
            (SegmentConfig::default().overlap.as_secs_f32() * TARGET_SAMPLE_RATE as f32) as usize;

        assert_eq!(second.start_sample, first.end_sample - overlap);
        assert_eq!(second.content_start_sample, first.end_sample);
    }

    #[test]
    fn does_not_emit_until_target_window_is_available() {
        let samples = seconds(4.9, 10_000);
        let mut segmenter = Segmenter::new(SegmentConfig::default());
        assert!(segmenter.next_range(&samples, TARGET_SAMPLE_RATE).is_none());
    }

    #[test]
    fn remaining_range_reuses_overlap_for_tail() {
        let samples = seconds(7.0, 10_000);
        let mut segmenter = Segmenter::new(SegmentConfig::default());
        let first = segmenter.next_range(&samples, TARGET_SAMPLE_RATE).unwrap();
        let tail = segmenter
            .remaining_range(samples.len(), TARGET_SAMPLE_RATE)
            .unwrap();

        assert_eq!(tail.content_start_sample, first.end_sample);
        assert!(tail.start_sample < tail.content_start_sample);
        assert_eq!(tail.end_sample, samples.len());
    }

    #[test]
    fn transcription_range_trims_leading_overlap() {
        let range = SegmentRange {
            start_sample: 56_000,
            content_start_sample: 80_000,
            end_sample: 120_000,
        };

        assert_eq!(
            range.for_transcription(),
            SegmentRange {
                start_sample: 80_000,
                content_start_sample: 80_000,
                end_sample: 120_000,
            }
        );
    }
}
