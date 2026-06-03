import 'package:flutter/painting.dart';

enum MirrorRotation { degrees0, degrees90, degrees180, degrees270 }

class MirrorDevicePoint {
  const MirrorDevicePoint({
    required this.x,
    required this.y,
    required this.screenWidth,
    required this.screenHeight,
  });

  final int x;
  final int y;
  final int screenWidth;
  final int screenHeight;
}

class MirrorTransform {
  const MirrorTransform({
    required this.deviceSize,
    required this.viewportSize,
    this.rotation = MirrorRotation.degrees0,
  });

  final Size deviceSize;
  final Size viewportSize;
  final MirrorRotation rotation;

  Size get displaySize {
    return switch (rotation) {
      MirrorRotation.degrees0 || MirrorRotation.degrees180 => deviceSize,
      MirrorRotation.degrees90 || MirrorRotation.degrees270 => Size(
          deviceSize.height,
          deviceSize.width,
        ),
    };
  }

  Rect get renderedRect {
    final fitted = applyBoxFit(BoxFit.contain, displaySize, viewportSize);
    final offset = Offset(
      (viewportSize.width - fitted.destination.width) / 2,
      (viewportSize.height - fitted.destination.height) / 2,
    );
    return offset & fitted.destination;
  }

  MirrorDevicePoint? devicePointForLocal(Offset localPosition) {
    final rect = renderedRect;
    if (!rect.contains(localPosition)) return null;
    final normalized = Offset(
      (localPosition.dx - rect.left) / rect.width,
      (localPosition.dy - rect.top) / rect.height,
    );
    final devicePoint = switch (rotation) {
      MirrorRotation.degrees0 => Offset(
          normalized.dx * deviceSize.width,
          normalized.dy * deviceSize.height,
        ),
      MirrorRotation.degrees90 => Offset(
          normalized.dy * deviceSize.width,
          (1 - normalized.dx) * deviceSize.height,
        ),
      MirrorRotation.degrees180 => Offset(
          (1 - normalized.dx) * deviceSize.width,
          (1 - normalized.dy) * deviceSize.height,
        ),
      MirrorRotation.degrees270 => Offset(
          (1 - normalized.dy) * deviceSize.width,
          normalized.dx * deviceSize.height,
        ),
    };

    return MirrorDevicePoint(
      x: _clampCoordinate(devicePoint.dx, deviceSize.width),
      y: _clampCoordinate(devicePoint.dy, deviceSize.height),
      screenWidth: deviceSize.width.round(),
      screenHeight: deviceSize.height.round(),
    );
  }

  int _clampCoordinate(double value, double maxExclusive) {
    if (maxExclusive <= 0) return 0;
    return value.clamp(0, maxExclusive - 1).round();
  }
}
