import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';

void main() {
  testWidgets('returns Duration.zero when disableAnimations is true',
      (tester) async {
    Duration? captured;
    bool? captureOf;
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: Builder(
            builder: (context) {
              captureOf = ReduceMotion.of(context);
              captured = ReduceMotion.duration(
                context,
                const Duration(milliseconds: 320),
              );
              return const SizedBox();
            },
          ),
        ),
      ),
    );
    expect(captureOf, isTrue);
    expect(captured, Duration.zero);
  });

  testWidgets('returns the normal duration when disableAnimations is false',
      (tester) async {
    Duration? captured;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            captured = ReduceMotion.duration(
              context,
              const Duration(milliseconds: 320),
            );
            return const SizedBox();
          },
        ),
      ),
    );
    expect(captured, const Duration(milliseconds: 320));
  });
}
