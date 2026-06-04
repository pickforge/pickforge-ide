# Visual Golden Policy

Pickforge golden baselines are generated on Linux with Flutter `3.41.7` and
the deterministic font loader in `test/support/golden_test_harness.dart`.

The policy is exact pixel matching on Linux. macOS and Windows keep running the
functional widget suite, but skip these pixel goldens to avoid cross-renderer
font and rasterization noise. If macOS pixel coverage becomes required, add a
separate macOS baseline set instead of relaxing the Linux comparator.

Update baselines with:

```bash
fvm flutter test --update-goldens test/goldens/visual_regression_test.dart
```

CI uploads Flutter golden `failures/` directories when the test step fails.
