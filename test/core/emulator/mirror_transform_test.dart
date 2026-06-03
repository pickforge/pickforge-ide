import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/mirror_transform.dart';

void main() {
  test('maps contained viewport coordinates into device coordinates', () {
    const transform = MirrorTransform(
      deviceSize: Size(100, 200),
      viewportSize: Size(200, 200),
    );

    expect(transform.renderedRect, const Rect.fromLTWH(50, 0, 100, 200));

    final point = transform.devicePointForLocal(const Offset(100, 100));

    expect(point?.x, 50);
    expect(point?.y, 100);
    expect(point?.screenWidth, 100);
    expect(point?.screenHeight, 200);
  });

  test('returns null for coordinates in the letterbox area', () {
    const transform = MirrorTransform(
      deviceSize: Size(100, 200),
      viewportSize: Size(200, 200),
    );

    expect(transform.devicePointForLocal(const Offset(10, 10)), isNull);
  });

  test('applies inverse clockwise rotation for 90 degree displays', () {
    const transform = MirrorTransform(
      deviceSize: Size(100, 200),
      viewportSize: Size(200, 100),
      rotation: MirrorRotation.degrees90,
    );

    final point = transform.devicePointForLocal(const Offset(50, 25));

    expect(point?.x, 25);
    expect(point?.y, 150);
  });

  test('applies inverse clockwise rotation for 270 degree displays', () {
    const transform = MirrorTransform(
      deviceSize: Size(100, 200),
      viewportSize: Size(200, 100),
      rotation: MirrorRotation.degrees270,
    );

    final point = transform.devicePointForLocal(const Offset(50, 25));

    expect(point?.x, 75);
    expect(point?.y, 50);
  });
}
