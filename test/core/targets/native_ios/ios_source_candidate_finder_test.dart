import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/native_ios/ios_source_candidate_finder.dart';

void main() {
  late Directory root;

  setUp(() {
    root = Directory.systemTemp.createTempSync('ios_src_finder_');
  });

  tearDown(() {
    if (root.existsSync()) root.deleteSync(recursive: true);
  });

  void write(String relative, String contents) {
    final file = File(p.join(root.path, relative));
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(contents);
  }

  const finder = IosSourceCandidateFinder();

  test('ranks accessibilityIdentifier over label over text', () async {
    write(
        'Sources/LoginView.swift',
        'let b = UIButton()\n'
            'b.accessibilityIdentifier = "login-submit"');
    write('Sources/Strings.swift', 'let cta = "Sign in now"');

    final candidates = await finder.find(
      projectRoot: root.path,
      signals: const IosSelectionSignals(
        accessibilityIdentifier: 'login-submit',
        text: 'Sign in now',
      ),
    );

    expect(candidates.first.signal, IosSourceSignal.accessibilityIdentifier);
    expect(candidates.first.confidence, IosSourceConfidence.high);
    expect(candidates.first.path, p.join('Sources', 'LoginView.swift'));
    expect(candidates.first.line, 2);
    expect(candidates.last.signal, IosSourceSignal.text);
  });

  test('skips Pods and matches a storyboard identifier', () async {
    write('Pods/Lib/Lib.swift', 'let id = "login-submit"');
    write(
      'Base.lproj/Main.storyboard',
      '<button accessibilityIdentifier="login-submit"/>',
    );

    final candidates = await finder.find(
      projectRoot: root.path,
      signals: const IosSelectionSignals(
        accessibilityIdentifier: 'login-submit',
      ),
    );

    expect(candidates, hasLength(1));
    expect(candidates.single.path, p.join('Base.lproj', 'Main.storyboard'));
  });
}
