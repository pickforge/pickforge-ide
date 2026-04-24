import 'dart:io';

import 'package:flutter/material.dart';

class ScreenshotPreview extends StatelessWidget {
  const ScreenshotPreview({super.key, this.path});

  final String? path;

  @override
  Widget build(BuildContext context) {
    if (path == null) return const SizedBox.shrink();
    return Image.file(
      File(path!),
      fit: BoxFit.contain,
      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
    );
  }
}
