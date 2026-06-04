import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

class SettingsSection extends StatelessWidget {
  const SettingsSection({
    required this.title,
    required this.children,
    super.key,
  });

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(PickforgeSpacing.md),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.32),
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.56),
        ),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          if (children.isNotEmpty) const SizedBox(height: PickforgeSpacing.md),
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0) const SizedBox(height: PickforgeSpacing.sm),
            children[index],
          ],
        ],
      ),
    );
  }
}

class SettingsField extends StatelessWidget {
  const SettingsField({
    required this.label,
    required this.child,
    this.alignment = CrossAxisAlignment.center,
    super.key,
  });

  final String label;
  final Widget child;
  final CrossAxisAlignment alignment;

  @override
  Widget build(BuildContext context) {
    final labelStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
          fontWeight: FontWeight.w600,
        );
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 520) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: labelStyle),
              const SizedBox(height: PickforgeSpacing.xs),
              child,
            ],
          );
        }
        return Row(
          crossAxisAlignment: alignment,
          children: [
            SizedBox(width: 136, child: Text(label, style: labelStyle)),
            const SizedBox(width: PickforgeSpacing.md),
            Expanded(child: child),
          ],
        );
      },
    );
  }
}

class SettingsToggleRow extends StatelessWidget {
  const SettingsToggleRow({
    required this.label,
    required this.value,
    required this.onChanged,
    this.switchKey,
    super.key,
  });

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;
  final Key? switchKey;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: switchKey,
      borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: PickforgeSpacing.xs),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            Switch(
              value: value,
              onChanged: onChanged,
            ),
          ],
        ),
      ),
    );
  }
}

class SettingsEmptyState extends StatelessWidget {
  const SettingsEmptyState({
    required this.icon,
    required this.message,
    super.key,
  });

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(PickforgeSpacing.lg),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.24),
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.48),
        ),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: colorScheme.onSurfaceVariant),
          const SizedBox(width: PickforgeSpacing.sm),
          Expanded(child: Text(message)),
        ],
      ),
    );
  }
}

InputDecoration settingsInputDecoration({
  String? labelText,
  String? helperText,
}) =>
    InputDecoration(
      isDense: true,
      labelText: labelText,
      helperText: helperText,
      border: const OutlineInputBorder(),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.md,
        vertical: PickforgeSpacing.sm,
      ),
    );

ButtonStyle settingsCompactButtonStyle() => OutlinedButton.styleFrom(
      visualDensity: VisualDensity.compact,
      minimumSize: const Size(0, 32),
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.md,
        vertical: PickforgeSpacing.sm,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
    );
