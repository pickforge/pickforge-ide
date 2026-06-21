// Device-mirror client: bytes from the Rust video relay (a Tauri Channel) →
// @yume-chan/scrcpy parser → WebCodecs decoder → <canvas>. Input (tap/swipe) is
// serialized with the library's exact 3.3.3 control format and written back via
// mirror_send_control. Rust owns the server/sockets (see mirror_commands.rs).
import { Channel, invoke } from "@tauri-apps/api/core";
import { ReadableStream } from "@yume-chan/stream-extra";
import {
  AndroidMotionEventAction,
  ScrcpyControlMessageType,
  ScrcpyOptionsLatest,
  ScrcpyPointerId,
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
} from "@yume-chan/scrcpy-decoder-webcodecs";

type ChannelBytes = ArrayBuffer | Uint8Array | number[];

function toU8(data: ChannelBytes): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

export const mirrorSupported = () => WebCodecsVideoDecoder.isSupported;

export interface MirrorHandle {
  /** Device video dimensions (updates on rotation). */
  size: () => { width: number; height: number };
  /** Pointer in canvas px → device touch. action: down/move/up. */
  touch: (action: "down" | "move" | "up", xRatio: number, yRatio: number) => void;
  stop: () => Promise<void>;
}

const ACTION = {
  down: AndroidMotionEventAction.Down,
  move: AndroidMotionEventAction.Move,
  up: AndroidMotionEventAction.Up,
} as const;

/** Start mirroring `serial` onto `canvas`. Throws if WebCodecs is unavailable. */
export async function startMirror(
  serial: string,
  canvas: HTMLCanvasElement,
  onSize?: (w: number, h: number) => void,
): Promise<MirrorHandle> {
  if (!WebCodecsVideoDecoder.isSupported) {
    throw new Error("WebCodecs (VideoDecoder) is not available in this webview");
  }

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

  const { stream, metadata } = await options.parseVideoStreamMetadata(raw);
  let size = { width: metadata.width ?? canvas.width, height: metadata.height ?? canvas.height };
  canvas.width = size.width;
  canvas.height = size.height;

  const renderer = new BitmapVideoFrameRenderer(canvas);
  const decoder = new WebCodecsVideoDecoder({ codec: metadata.codec, renderer });
  decoder.sizeChanged(({ width, height }) => {
    size = { width, height };
    canvas.width = width;
    canvas.height = height;
    onSize?.(width, height);
  });

  // Pipe: raw stream → packet transformer → decoder. Errors end the mirror.
  void stream
    .pipeThrough(options.createMediaStreamTransformer())
    .pipeTo(decoder.writable)
    .catch(() => {});

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
    decoder.dispose();
    await invoke("mirror_stop", { serial }).catch(() => {});
  };

  return { size: () => size, touch, stop };
}
