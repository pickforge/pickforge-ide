// Device-mirror client: bytes from the Rust video relay (a Tauri Channel) →
// @yume-chan/scrcpy parser → WebCodecs decoder → <canvas>. Input (tap/swipe) is
// serialized with the library's exact 3.3.3 control format and written back via
// mirror_send_control. Rust owns the server/sockets (see mirror_commands.rs).
import { Channel, invoke } from "@tauri-apps/api/core";
import { ReadableStream, WritableStream } from "@yume-chan/stream-extra";
import {
  AndroidMotionEventAction,
  annexBSplitNalu,
  h264ParseConfiguration,
  ScrcpyControlMessageType,
  ScrcpyOptionsLatest,
  ScrcpyPointerId,
  type H264Configuration,
  type ScrcpyMediaStreamPacket,
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** Build an avcC (AVCDecoderConfigurationRecord) from the parsed SPS/PPS — the
 *  `description` WebKitGTK's VideoDecoder requires for avc1. */
function buildAvcC(cfg: H264Configuration): Uint8Array {
  const sps = cfg.sequenceParameterSet;
  const pps = cfg.pictureParameterSet;
  const out = new Uint8Array(11 + sps.length + pps.length);
  const dv = new DataView(out.buffer);
  let o = 0;
  out[o++] = 1; // configurationVersion
  out[o++] = cfg.profileIndex;
  out[o++] = cfg.constraintSet;
  out[o++] = cfg.levelIndex;
  out[o++] = 0xff; // 6 reserved bits | lengthSizeMinusOne = 3 (4-byte lengths)
  out[o++] = 0xe1; // 3 reserved bits | numOfSequenceParameterSets = 1
  dv.setUint16(o, sps.length);
  o += 2;
  out.set(sps, o);
  o += sps.length;
  out[o++] = 1; // numOfPictureParameterSets
  dv.setUint16(o, pps.length);
  o += 2;
  out.set(pps, o);
  return out;
}

/** Annex B (start-code-delimited NALUs) → AVCC (4-byte length-prefixed). */
function annexBToAvcc(data: Uint8Array): Uint8Array {
  const nalus: Uint8Array[] = [];
  let total = 0;
  for (const nalu of annexBSplitNalu(data)) {
    nalus.push(nalu);
    total += 4 + nalu.length;
  }
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const nalu of nalus) {
    dv.setUint32(o, nalu.length);
    o += 4;
    out.set(nalu, o);
    o += nalu.length;
  }
  return out;
}

type ChannelBytes = ArrayBuffer | Uint8Array | number[];

function toU8(data: ChannelBytes): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

export const mirrorSupported = () => WebCodecsVideoDecoder.isSupported;

export interface MirrorStats {
  rendered: number;
  skipped: number;
  width: number;
  height: number;
  renderer: string;
  /** WebKitGTK H.264 WebCodecs support probe (baseline/high). */
  avc: string;
  error: string;
}

/** Does this webview's VideoDecoder actually accept H.264? `isSupported` only
 *  checks the API exists, not the codec — probe both common profiles. */
async function probeAvc(): Promise<string> {
  if (typeof VideoDecoder === "undefined") return "no-VideoDecoder";
  try {
    const cfg = (codec: string) => ({ codec, codedWidth: 1280, codedHeight: 720 });
    const base = await VideoDecoder.isConfigSupported(cfg("avc1.42E01E"));
    const high = await VideoDecoder.isConfigSupported(cfg("avc1.640028"));
    return `base:${base.supported ? 1 : 0} high:${high.supported ? 1 : 0}`;
  } catch (e) {
    return `probe-fail:${String((e as Error)?.message ?? e)}`;
  }
}

export interface MirrorHandle {
  /** Device video dimensions (updates on rotation). */
  size: () => { width: number; height: number };
  /** Pointer in canvas px → device touch. action: down/move/up. */
  touch: (action: "down" | "move" | "up", xRatio: number, yRatio: number) => void;
  /** Live decode/render counters + last error, for the pane's status line. */
  stats: () => MirrorStats;
  stop: () => Promise<void>;
}

const ACTION = {
  down: AndroidMotionEventAction.Down,
  move: AndroidMotionEventAction.Move,
  up: AndroidMotionEventAction.Up,
} as const;

/** Start mirroring `serial` onto `canvas`. Throws if WebCodecs is unavailable. */
// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export async function startMirror(
  serial: string,
  canvas: HTMLCanvasElement,
  onSize?: (w: number, h: number) => void,
): Promise<MirrorHandle> {
  if (!WebCodecsVideoDecoder.isSupported) {
    throw new Error("WebCodecs (VideoDecoder) is not available in this webview");
  }
  const avc = await probeAvc();

  // Options must mirror the flags Rust passes the server (h264, codec+frame meta,
  // no device meta) so the parser reads the stream correctly.
  const options = new ScrcpyOptionsLatest({
    audio: false,
    video: true,
    videoCodec: "h264",
    sendDeviceMeta: false,
    sendCodecMeta: true,
    sendFrameMeta: true,
    control: true,
  });

  // The video socket bytes arrive on this channel; feed them into a stream.
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const raw = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const channel = new Channel<ChannelBytes>();
  channel.onmessage = (data) => {
    try {
      controller?.enqueue(toU8(data));
    } catch {
      /* stream closed */
    }
  };

  await invoke("mirror_start", { serial, onVideo: channel });

  // mirror_start registered a Rust session; if anything below throws, the caller
  // has no handle to stop it — so tear it down here on failure.
  try {
    const { stream, metadata } = await options.parseVideoStreamMetadata(raw);
  let size = { width: metadata.width ?? canvas.width, height: metadata.height ?? canvas.height };
  canvas.width = size.width;
  canvas.height = size.height;

  // WebGL (texImage2D from a VideoFrame) renders reliably on WebKitGTK; the
  // Bitmap renderer's createImageBitmap(VideoFrame) often doesn't.
  const rendererKind = WebGLVideoFrameRenderer.isSupported ? "webgl" : "bitmap";
  const renderer =
    rendererKind === "webgl"
      ? new WebGLVideoFrameRenderer(canvas)
      : new BitmapVideoFrameRenderer(canvas);

  let lastError = "";
  let rendered = 0;
  let ts = 0;
  // WebKitGTK's VideoDecoder only accepts AVCC (length-prefixed NALUs + an avcC
  // `description`); @yume-chan emits Annex B (start codes), which WebKitGTK reads
  // as a bogus NAL length → "Decode error". So we drive a raw VideoDecoder and
  // transmux each packet Annex B → AVCC ourselves.
  const decoder = new VideoDecoder({
    output: (frame) => {
      rendered++;
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        size = { width: frame.displayWidth, height: frame.displayHeight };
        canvas.width = size.width;
        canvas.height = size.height;
        renderer.setSize(size.width, size.height);
        onSize?.(size.width, size.height);
      }
      void Promise.resolve(renderer.draw(frame))
        .catch(() => {})
        .finally(() => frame.close());
    },
    error: (e) => {
      lastError = `${e.name}: ${e.message}`;
      console.error("[mirror] VideoDecoder error", e);
    },
  });

  const sink = new WritableStream<ScrcpyMediaStreamPacket>({
    write(packet) {
      try {
        if (packet.type === "configuration") {
          const cfg = h264ParseConfiguration(packet.data);
          const codec = `avc1.${hex2(cfg.profileIndex)}${hex2(cfg.constraintSet)}${hex2(cfg.levelIndex)}`;
          decoder.configure({
            codec,
            description: buildAvcC(cfg),
            optimizeForLatency: true,
            hardwareAcceleration: "prefer-hardware",
          });
        } else if (decoder.state === "configured") {
          decoder.decode(
            new EncodedVideoChunk({
              type: packet.keyframe === false ? "delta" : "key",
              timestamp: ts,
              data: annexBToAvcc(packet.data),
            }),
          );
          ts += Math.round(1_000_000 / 60); // monotonic ~60fps spacing
        }
      } catch (e) {
        lastError = `${(e as Error)?.name ?? "Error"}: ${(e as Error)?.message ?? String(e)}`;
      }
    },
  });

  void stream
    .pipeThrough(options.createMediaStreamTransformer())
    .pipeTo(sink)
    .catch((e) => {
      lastError = `${e?.name ? e.name + ": " : ""}${e?.message ?? String(e)}`;
      console.error("[mirror] decode pipe failed", e);
    });

  const touch = (action: "down" | "move" | "up", xRatio: number, yRatio: number) => {
    const x = Math.max(0, Math.min(size.width - 1, Math.round(xRatio * size.width)));
    const y = Math.max(0, Math.min(size.height - 1, Math.round(yRatio * size.height)));
    const bytes = options.serializeInjectTouchControlMessage({
      type: ScrcpyControlMessageType.InjectTouch,
      action: ACTION[action],
      pointerId: ScrcpyPointerId.Finger,
      pointerX: x,
      pointerY: y,
      videoWidth: size.width,
      videoHeight: size.height,
      pressure: action === "up" ? 0 : 1,
      actionButton: 0,
      buttons: action === "up" ? 0 : 1,
    });
    void invoke("mirror_send_control", { serial, bytes: Array.from(bytes) }).catch(() => {});
  };

  const stop = async () => {
    try {
      controller?.close();
    } catch {
      /* already closed */
    }
    if (decoder.state !== "closed") decoder.close();
    await invoke("mirror_stop", { serial }).catch(() => {});
  };

  const stats = (): MirrorStats => ({
    rendered,
    skipped: decoder.decodeQueueSize,
    width: size.width,
    height: size.height,
    renderer: rendererKind,
    avc,
    error: lastError,
  });

    return { size: () => size, touch, stats, stop };
  } catch (e) {
    await invoke("mirror_stop", { serial }).catch(() => {});
    throw e;
  }
}
