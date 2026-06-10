import 'package:flutter/material.dart';
import 'package:pickforge/shared/components/selection_bracket.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// The branded empty state — a bracket-framed glyph with a mono eyebrow and a
/// quiet explanation. Replaces dead "nothing here" voids with the brand's
/// blueprint voice while staying ember-free (an empty panel is never the
/// composition's focal point).
class ForgeEmptyState extends StatelessWidget {
  const ForgeEmptyState({
    required this.icon,
    required this.title,
    super.key,
    this.eyebrow,
    this.hint,
    this.action,
  });

  final IconData icon;
  final String title;

  /// Mono uppercase label above the title (e.g. `INSPECTOR`).
  final String? eyebrow;

  /// Muted one-liner under the title.
  final String? hint;

  /// Optional trailing action (keep it quiet — outlined / text button).
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 300),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SelectionBracket(
              inset: 6,
              armLength: 11,
              color: PickforgeColors.textLow,
              emberCorner: false,
              child: Container(
                padding: const EdgeInsets.all(PickforgeSpacing.md),
                decoration: BoxDecoration(
                  color: PickforgeColors.surface1,
                  borderRadius:
                      BorderRadius.circular(PickforgeSpacing.radiusMd),
                  border: Border.all(color: PickforgeColors.hairline),
                ),
                child: Icon(icon, size: 22, color: PickforgeColors.textMed),
              ),
            ),
            const SizedBox(height: PickforgeSpacing.lg),
            if (eyebrow != null) ...[
              Text(
                eyebrow!.toUpperCase(),
                style: PickforgeText.eyebrow.copyWith(
                  color: PickforgeColors.textLow,
                ),
              ),
              const SizedBox(height: PickforgeSpacing.sm),
            ],
            Text(
              title,
              style: textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            if (hint != null) ...[
              const SizedBox(height: PickforgeSpacing.xs),
              Text(
                hint!,
                style: textTheme.bodySmall?.copyWith(
                  color: PickforgeColors.textLow,
                  height: 1.5,
                ),
                textAlign: TextAlign.center,
              ),
            ],
            if (action != null) ...[
              const SizedBox(height: PickforgeSpacing.lg),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}
