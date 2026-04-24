import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';

class NoSelectionPlaceholder extends StatelessWidget {
  const NoSelectionPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: const Text('Tap a widget in the emulator to pick it')
          .animate(onPlay: (c) => c.repeat(reverse: true))
          .fadeIn(
            duration: PickforgeMotion.standard,
            curve: PickforgeMotion.curveOut,
          )
          .then(delay: const Duration(seconds: 1))
          .fadeOut(duration: PickforgeMotion.slow),
    );
  }
}
