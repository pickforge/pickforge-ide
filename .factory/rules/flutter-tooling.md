# Flutter Tooling Rules

- Always use FVM for Flutter and Dart commands in this repository:
  - `fvm flutter ...`
  - `fvm dart ...`
- Do not use raw `flutter` or `dart` for repo validation, codegen, tests, or app runs.
- Standard local validation is:
  - `fvm dart format --set-exit-if-changed .`
  - `fvm flutter analyze`
  - `fvm flutter test`
- `scripts/check.sh` is the canonical local check script and runs the same three commands.
- CI runs on Linux, macOS, and Windows. It installs FVM, runs `fvm flutter pub get`, runs codegen, checks for codegen drift, formats, analyzes, and runs `fvm flutter test --coverage`.
- Use the repo's existing dependency set from `pubspec.yaml`; do not add packages without confirming they fit the existing architecture and are needed.
