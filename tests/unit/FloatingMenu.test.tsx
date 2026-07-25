// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { FloatingMenu } from "../../src/components/FloatingMenu";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 800);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  document.querySelector(".pf-floating-menu")?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FloatingMenu", () => {
  it("places a bottom-aligned menu from its untransformed border-box size", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    const transformedRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 232.8,
        height: 194,
        top: 0,
        right: 232.8,
        bottom: 194,
        left: 0,
        toJSON: () => ({}),
      });

    dispose = render(
      () => (
        <FloatingMenu anchor={{ x: 990, y: 750, align: "end" }} onClose={() => {}}>
          <button>Menu item</button>
        </FloatingMenu>
      ),
      root,
    );

    const menu = document.querySelector<HTMLElement>(".pf-floating-menu")!;
    expect(menu.style.left).toBe("750px");
    expect(menu.style.top).toBe("550px");
    expect(menu.style.visibility).toBe("visible");
    expect(transformedRect).not.toHaveBeenCalled();
  });
});
