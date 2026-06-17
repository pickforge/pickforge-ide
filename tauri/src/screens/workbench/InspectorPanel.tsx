// Right-rail inspector / forge. The live selection + forge dispatch ride on the
// VM-service + device bridges, which land in a later phase; until then this is a
// branded empty state.
import { ForgeEmptyState, MonoEyebrow, StatusPill } from "../../components/ui";

export function InspectorPanel() {
  return (
    <div class="pf-inspector">
      <div class="pf-inspector-head">
        <MonoEyebrow text="Inspector" tick />
        <StatusPill label="disconnected" intent="neutral" />
      </div>
      <ForgeEmptyState
        glyph={<span style={{ "font-size": "22px" }}>◎</span>}
        eyebrow="No target"
        title="No app connected"
        hint="Run a target app to inspect widgets and forge changes. The VM-service + device bridges that drive this panel arrive with the adapters phase."
      />
    </div>
  );
}
