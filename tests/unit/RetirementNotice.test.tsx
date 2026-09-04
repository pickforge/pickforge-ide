// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { RetirementNotice } from "../../src/components/RetirementNotice";

const opener = vi.hoisted(() => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock("../../src/lib/opener", () => ({ openExternalUrl: opener.openExternalUrl }));

describe("RetirementNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    opener.openExternalUrl.mockClear();
  });

  it("states the final-release contract and opens both retirement destinations", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <RetirementNotice />, root);

    expect(root.textContent).toContain("PickForge IDE retired on September 3, 2026");
    expect(root.textContent).toContain("Version 0.2.1 is the final release");
    expect(root.textContent).toContain("keeps working offline");
    expect(root.textContent).toContain("no further updates");

    const links = root.querySelectorAll<HTMLButtonElement>(".pf-retirement-link");
    links[0].click();
    links[1].click();
    expect(opener.openExternalUrl).toHaveBeenNthCalledWith(1, "https://pickforge.dev");
    expect(opener.openExternalUrl).toHaveBeenNthCalledWith(
      2,
      "https://github.com/pickforge/pickforge-ide",
    );

    dispose();
    root.remove();
  });

  it("stays dismissed after the first v0.2.1 startup notice", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <RetirementNotice />, root);

    root.querySelector<HTMLButtonElement>("[aria-label='Dismiss retirement notice']")?.click();
    expect(root.querySelector(".pf-retirement")).toBeNull();
    expect(localStorage.getItem("pickforge.retirementNoticeDismissed.v0.2.1")).toBe("true");
    dispose();

    const disposeAgain = render(() => <RetirementNotice />, root);
    expect(root.querySelector(".pf-retirement")).toBeNull();
    disposeAgain();
    root.remove();
  });
});
