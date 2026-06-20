import { open } from "@tauri-apps/plugin-dialog";
import {
  BlueprintGrid,
  EmberButton,
  MonoEyebrow,
  SelectionBracket,
} from "../components/ui";
import { addProject } from "../stores/workspace";
import { navigate } from "../router";
import "./screens.css";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}

export function OnboardingScreen() {
  const pick = async () => {
    const dir = await open({ directory: true, title: "Add a project" });
    if (typeof dir === "string") {
      await addProject(dir, basename(dir));
      navigate("workbench");
    }
  };
  const skip = () => {
    localStorage.setItem("pickforge.onboardingDismissed", "true");
    navigate("workbench");
  };

  return (
    <BlueprintGrid halo>
      <div class="pf-onboarding">
        <SelectionBracket active emberCorner={false} inset={12} armLength={16}>
          <div class="pf-onboarding-mark">
            <span class="pf-mark" />
          </div>
        </SelectionBracket>
        <MonoEyebrow text="Welcome" tick />
        <h1 class="pf-onboarding-title">Forge UI from your terminal.</h1>
        <p class="pf-onboarding-sub">
          Point PickForge at a project and drive Claude, Codex, and your tools
          from a shell-first workbench.
        </p>
        <div class="pf-onboarding-actions">
          <EmberButton label="Add a project" onClick={pick} />
          <button class="pf-text-btn" onClick={skip}>
            Skip for now
          </button>
        </div>
      </div>
    </BlueprintGrid>
  );
}
