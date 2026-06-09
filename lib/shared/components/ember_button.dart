import 'package:flutter/material.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_elevation.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// The signature primary CTA — a pill that carries the ember glow and a
/// magnetic micro-interaction (lifts + glows on hover, presses in on tap).
///
/// This is the "hero" button (onboarding, Forge it). For routine actions use a
/// themed [FilledButton]/[OutlinedButton]; this one is meant to be rare and
/// loud — honor the one-ember rule.
class EmberButton extends StatefulWidget {
  const EmberButton({
    required this.label,
    super.key,
    this.onPressed,
    this.icon,
    this.expand = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  /// Stretch to the full width of the parent.
  final bool expand;

  @override
  State<EmberButton> createState() => _EmberButtonState();
}

class _EmberButtonState extends State<EmberButton> {
  bool _hovered = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    final reduce = ReduceMotion.of(context);
    final scale = !enabled || reduce
        ? 1.0
        : _pressed
            ? 0.97
            : _hovered
                ? 1.02
                : 1.0;
    final bg = !enabled
        ? PickforgeColors.surface3
        : _pressed
            ? PickforgeColors.emberDeep
            : _hovered
                ? PickforgeColors.emberSoft
                : PickforgeColors.ember;

    return MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _pressed = true) : null,
        onTapUp: enabled ? (_) => setState(() => _pressed = false) : null,
        onTapCancel: enabled ? () => setState(() => _pressed = false) : null,
        onTap: widget.onPressed,
        child: AnimatedScale(
          scale: scale,
          duration: ReduceMotion.duration(context, PickforgeMotion.fast),
          curve: PickforgeMotion.forge,
          child: AnimatedContainer(
            duration: ReduceMotion.duration(context, PickforgeMotion.fast),
            curve: PickforgeMotion.forge,
            width: widget.expand ? double.infinity : null,
            padding: const EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.xl,
              vertical: PickforgeSpacing.md,
            ),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusPill),
              boxShadow: !enabled
                  ? null
                  : _hovered
                      ? PickforgeElevation.ember
                      : PickforgeElevation.emberSoft,
            ),
            child: Row(
              mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (widget.icon != null) ...[
                  Icon(
                    widget.icon,
                    size: 17,
                    color: enabled
                        ? PickforgeColors.surface
                        : PickforgeColors.textLow,
                  ),
                  const SizedBox(width: PickforgeSpacing.sm),
                ],
                Text(
                  widget.label,
                  style: PickforgeText.eyebrow.copyWith(
                    fontFamily: kPickforgeSans,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.2,
                    color: enabled
                        ? PickforgeColors.surface
                        : PickforgeColors.textLow,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
