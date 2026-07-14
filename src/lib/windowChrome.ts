const INTERACTIVE_TITLEBAR_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [contenteditable='true']";

const DOUBLE_PRESS_INTERVAL_MS = 500;
const DOUBLE_PRESS_MAX_DISTANCE_PX = 5;
const DRAG_START_DISTANCE_PX = 4;

let activePrimaryPress: { clientX: number; clientY: number } | undefined;
let dragStarted = false;
let lastPrimaryPress: { timeStamp: number; clientX: number; clientY: number } | undefined;

function isInteractiveTitlebarTarget(event: MouseEvent): boolean {
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  return Boolean(target?.closest?.(INTERACTIVE_TITLEBAR_SELECTOR));
}


function resetTitlebarDoublePress(): void {
  activePrimaryPress = undefined;
  dragStarted = false;
  lastPrimaryPress = undefined;
}

export function resetTitlebarDoublePressForTest(): void {
  resetTitlebarDoublePress();
}

export function handleTitlebarMouseDown(event: MouseEvent): void {
  if (event.button !== 0 || isInteractiveTitlebarTarget(event)) {
    resetTitlebarDoublePress();
    return;
  }

  const currentPress = {
    timeStamp: event.timeStamp,
    clientX: event.clientX,
    clientY: event.clientY,
  };
  const previousPress = lastPrimaryPress;
  activePrimaryPress = currentPress;
  dragStarted = false;
  const elapsed = previousPress ? currentPress.timeStamp - previousPress.timeStamp : Infinity;
  lastPrimaryPress = currentPress;

  if (
    !previousPress ||
    elapsed < 0 ||
    elapsed > DOUBLE_PRESS_INTERVAL_MS ||
    Math.hypot(
      currentPress.clientX - previousPress.clientX,
      currentPress.clientY - previousPress.clientY,
    ) > DOUBLE_PRESS_MAX_DISTANCE_PX
  ) {
    return;
  }

  resetTitlebarDoublePress();
  event.preventDefault();
  event.stopPropagation();
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
    .catch(() => {});
}

export function handleTitlebarMouseUp(event: MouseEvent): void {
  if (event.button === 0) {
    activePrimaryPress = undefined;
    dragStarted = false;
  }
}

export function handleTitlebarMouseMove(event: MouseEvent): void {
  if (event.buttons === 0) {
    activePrimaryPress = undefined;
    dragStarted = false;
    return;
  }
  if (event.buttons !== 1) {
    resetTitlebarDoublePress();
    return;
  }
  if (!activePrimaryPress || dragStarted) {
    return;
  }
  if (
    Math.hypot(
      event.clientX - activePrimaryPress.clientX,
      event.clientY - activePrimaryPress.clientY,
    ) <= DRAG_START_DISTANCE_PX
  ) {
    return;
  }

  lastPrimaryPress = undefined;
  activePrimaryPress = undefined;
  dragStarted = true;
  event.preventDefault();
  event.stopPropagation();
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
    .catch(() => {});
}
