import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/web/web_source_candidate_finder.dart';

void main() {
  late Directory root;

  setUp(() {
    root = Directory.systemTemp.createTempSync('web_src_finder_');
  });

  tearDown(() {
    if (root.existsSync()) root.deleteSync(recursive: true);
  });

  void write(String relative, String contents) {
    final file = File(p.join(root.path, relative));
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(contents);
  }

  const finder = WebSourceCandidateFinder();

  test('ranks testid/id over class/name over text', () async {
    write('src/LoginForm.tsx', '''
export function LoginForm() {
  return <button data-testid="login-submit">Sign in</button>;
}
''');
    write('src/styles.css', '.cta-primary { color: red; }');
    write('src/Banner.tsx', '<h1>Welcome back traveller</h1>');

    final candidates = await finder.find(
      projectRoot: root.path,
      signals: const WebSelectionSignals(
        testId: 'login-submit',
        className: 'cta-primary',
        text: 'Welcome back traveller',
      ),
    );

    expect(candidates.first.signal, WebSourceSignal.testId);
    expect(candidates.first.confidence, WebSourceConfidence.high);
    expect(candidates.first.path, p.join('src', 'LoginForm.tsx'));
    expect(candidates.first.line, 2);

    final signals = candidates.map((c) => c.signal).toList();
    expect(signals, contains(WebSourceSignal.className));
    expect(signals, contains(WebSourceSignal.text));
    // Text (low) must rank last.
    expect(candidates.last.signal, WebSourceSignal.text);
  });

  test('skips node_modules and matches on a bounded token only', () async {
    write('node_modules/pkg/index.js', 'const id = "login";');
    write('src/App.jsx', '<input id="login" />\n<div id="login-extra" />');

    final candidates = await finder.find(
      projectRoot: root.path,
      signals: const WebSelectionSignals(domId: 'login'),
    );

    expect(candidates, hasLength(1));
    expect(candidates.single.path, p.join('src', 'App.jsx'));
    expect(candidates.single.signal, WebSourceSignal.domId);
    // The bounded match hits `id="login"` on line 1, not `login-extra`.
    expect(candidates.single.line, 1);
  });

  test('records the highest-confidence signal when a file matches several',
      () async {
    // One file matching both a high (testId) and low (text) signal must be
    // recorded at the high confidence, not whichever appears first in the file.
    write(
        'src/Card.tsx',
        '<article>Read more</article>\n'
            '<a data-testid="card-cta">Read more</a>');

    final candidates = await finder.find(
      projectRoot: root.path,
      signals: const WebSelectionSignals(
        testId: 'card-cta',
        text: 'Read more',
      ),
    );

    expect(candidates, hasLength(1));
    expect(candidates.single.signal, WebSourceSignal.testId);
    expect(candidates.single.confidence, WebSourceConfidence.high);
  });

  test('matches a CSS class selector by its bare token', () async {
    write('src/app.css', '.cta-primary { color: red; }');
    final candidates = await finder.find(
      projectRoot: root.path,
      signals: const WebSelectionSignals(className: 'cta-primary'),
    );
    expect(candidates.single.path, p.join('src', 'app.css'));
    expect(candidates.single.signal, WebSourceSignal.className);
  });

  test('returns nothing when no signal meets the minimum length', () async {
    write('src/App.jsx', '<button id="ok">go</button>');
    final candidates = await finder.find(
      projectRoot: root.path,
      signals: const WebSelectionSignals(domId: 'ok', text: 'go'),
    );
    expect(candidates, isEmpty);
  });
}
