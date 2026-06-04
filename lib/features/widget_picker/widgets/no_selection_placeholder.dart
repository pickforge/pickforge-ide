import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';

class NoSelectionPlaceholder extends StatelessWidget {
  const NoSelectionPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Text(AppLocalizations.of(context).widgetPickerNoSelection);
    if (ReduceMotion.of(context)) {
      return Center(child: text);
    }
    return Center(
      child: text
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
