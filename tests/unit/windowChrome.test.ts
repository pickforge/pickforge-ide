import { beforeEach, describe, expect, it, vi } from "vitest";

const toggleMaximize = vi.fn(() => Promise.resolve());
const startDragging = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging, toggleMaximize }),
}));

import {
  handleTitlebarMouseDown,
  handleTitlebarMouseMove,
  handleTitlebarMouseUp,
  resetTitlebarDoublePressForTest,
} from "../../src/lib/windowChrome";

function mouseEvent({
  button = 0,
  buttons = 0,
  timeStamp = 0,
  clientX = 0,
  clientY = 0,
  interactive = false,
}: {
  button?: number;
  buttons?: number;
  timeStamp?: number;
  clientX?: number;
  clientY?: number;
  interactive?: boolean;
} = {}): MouseEvent {
  return {
    button,
    buttons,
    timeStamp,
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: {
      closest: vi.fn(() => (interactive ? {} : null)),
    },
  } as unknown as MouseEvent;
}

beforeEach(() => {
  resetTitlebarDoublePressForTest();
  toggleMaximize.mockClear();
  startDragging.mockClear();
});

describe("titlebar window controls", () => {
  it("maximizes after two detail-1 primary presses despite zero and tiny pressed moves", async () => {
    handleTitlebarMouseDown(mouseEvent({ buttons: 1, timeStamp: 100, clientX: 20, clientY: 10 }));
    handleTitlebarMouseMove(mouseEvent({ buttons: 1, clientX: 20, clientY: 10 }));
    handleTitlebarMouseMove(mouseEvent({ buttons: 1, clientX: 21, clientY: 11 }));
    const secondPress = mouseEvent({ buttons: 1, timeStamp: 400, clientX: 23, clientY: 14 });
    handleTitlebarMouseDown(secondPress);

    await vi.waitFor(() => expect(toggleMaximize).toHaveBeenCalledOnce());
    expect(startDragging).not.toHaveBeenCalled();
    expect(secondPress.preventDefault).toHaveBeenCalledOnce();
    expect(secondPress.stopPropagation).toHaveBeenCalledOnce();
  });

  it("does not maximize after the double-press interval expires", async () => {
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 100 }));
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 601 }));

    await Promise.resolve();
    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("does not maximize when the second press is outside the click radius", async () => {
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 100, clientX: 10, clientY: 10 }));
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 200, clientX: 16, clientY: 10 }));

    await Promise.resolve();
    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("starts one native drag after movement crosses the threshold and cancels the double press", async () => {
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 100, clientX: 0, clientY: 0 }));
    const drag = mouseEvent({ buttons: 1, timeStamp: 200, clientX: 5, clientY: 0 });
    handleTitlebarMouseMove(drag);
    handleTitlebarMouseMove(mouseEvent({ buttons: 1, timeStamp: 210, clientX: 10, clientY: 0 }));
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 300, clientX: 0, clientY: 0 }));

    await vi.waitFor(() => expect(startDragging).toHaveBeenCalledOnce());
    expect(toggleMaximize).not.toHaveBeenCalled();
    expect(drag.preventDefault).toHaveBeenCalledOnce();
  });

  it("cancels a pending double press for interactive titlebar children", async () => {
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 100 }));
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 200, interactive: true }));
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 300 }));

    await Promise.resolve();
    expect(toggleMaximize).not.toHaveBeenCalled();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("cancels a pending double press for non-primary input", async () => {
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 100 }));
    handleTitlebarMouseDown(mouseEvent({ button: 2, timeStamp: 200 }));
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 300 }));

    await Promise.resolve();
    expect(toggleMaximize).not.toHaveBeenCalled();
  });
  it("clears a released origin without discarding the pending double press", async () => {
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 100, clientX: 10, clientY: 10 }));
    handleTitlebarMouseUp(mouseEvent({ button: 0 }));
    handleTitlebarMouseMove(mouseEvent({ buttons: 1, clientX: 20, clientY: 10 }));
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 200, clientX: 12, clientY: 12 }));

    await vi.waitFor(() => expect(toggleMaximize).toHaveBeenCalledOnce());
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("does not drag when an interactive press moves into the titlebar", async () => {
    handleTitlebarMouseDown(mouseEvent({ interactive: true, timeStamp: 100 }));
    handleTitlebarMouseMove(mouseEvent({ buttons: 1, clientX: 10 }));

    await Promise.resolve();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("starts dragging when a blank press crosses an interactive child", async () => {
    handleTitlebarMouseDown(mouseEvent({ timeStamp: 100 }));
    handleTitlebarMouseMove(mouseEvent({ buttons: 1, clientX: 5, interactive: true }));

    await vi.waitFor(() => expect(startDragging).toHaveBeenCalledOnce());
  });
});
