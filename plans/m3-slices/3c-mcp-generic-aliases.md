# Milestone 3 · Slice 3C — MCP generic target aliases

Depends on 3A/3B. ADDITIVE: adds the framework-neutral MCP names without changing
any existing payloads. Satisfies "Add new generic MCP method names while preserving
existing names" + "`get_selected_widget` remains a compatibility alias".

## Design (Codex-reviewed)

The two genuinely-new generic names are `get_current_selection` and
`capture_target_screenshot` (`hot_reload`/`get_run_logs`/`get_project_context`
already use generic names). Both are **thin aliases** that return the identical
payload as their legacy counterpart — no schema change, since no consumer needs the
lossy generic `TargetSelection` shape over the wire yet (STOP: don't drop precision).

## Changes
- `lib/core/mcp/pickforge_mcp_server.dart`: add `get_current_selection` and
  `capture_target_screenshot` to the const `_tools` list (the server forwards the
  tool name verbatim as the IPC `method`).
- `lib/core/emulator/emulator_ipc_server.dart`: add `case 'get_current_selection':`
  beside `getCurrentSelection`/`get_selected_widget` (→ `_selectionProvider`) and
  `case 'capture_target_screenshot':` beside `capture_screenshot` (→
  `_screenshotProvider`).

## Tests
- `test/core/emulator/emulator_ipc_server_test.dart`: bind selection + screenshot
  providers, assert the generic names return the SAME result as the legacy names.
- `test/core/mcp/pickforge_mcp_server_test.dart`: `tools/list` includes the two new
  names; `tools/call` on each forwards the name verbatim to the IPC endpoint.

## Verification
1. `fvm dart format --set-exit-if-changed .`
2. `fvm flutter analyze` (0 issues)
3. `fvm flutter test test/core/mcp/ test/core/emulator/`

## STOP conditions
- Generic aliases must carry the identical payload as the legacy names (no precision
  loss); existing names keep working unchanged.
