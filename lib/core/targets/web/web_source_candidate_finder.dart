import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;

/// How strongly a source file is believed to relate to a web selection.
enum WebSourceConfidence { high, medium, low }

/// Which selection signal produced a source candidate.
enum WebSourceSignal { testId, domId, className, accessibleName, text }

/// The searchable strings a selected DOM/accessibility node exposes. A live CDP
/// session fills these from the DOM node + a11y tree; the search itself is pure
/// and fixture-testable.
class WebSelectionSignals extends Equatable {
  const WebSelectionSignals({
    this.testId,
    this.domId,
    this.className,
    this.accessibleName,
    this.text,
  });

  /// `data-testid` / `data-test` value (highest confidence).
  final String? testId;

  /// Element `id` attribute.
  final String? domId;

  /// A single class token (not the whole `class` string).
  final String? className;

  /// ARIA / computed accessible name.
  final String? accessibleName;

  /// Visible text content (lowest confidence).
  final String? text;

  @override
  List<Object?> get props => [testId, domId, className, accessibleName, text];
}

/// A likely source file for a web selection — NEVER an exact mapping. For exact
/// positions use `SourceMap`; this is the text-search fallback for when no
/// source map covers the selection.
class WebSourceCandidate extends Equatable {
  const WebSourceCandidate({
    required this.path,
    required this.confidence,
    required this.signal,
    required this.matchedValue,
    this.line,
  });

  /// Project-relative path.
  final String path;
  final int? line;
  final WebSourceConfidence confidence;
  final WebSourceSignal signal;
  final String matchedValue;

  Map<String, Object?> toJson() => {
        'path': path,
        'line': line,
        'confidence': confidence.name,
        'signal': signal.name,
        'matchedValue': matchedValue,
      };

  @override
  List<Object?> get props => [path, line, confidence, signal, matchedValue];
}

/// Searches a web project's JS/TS/markup/style sources for the values a selected
/// node exposes — `data-testid` and `id` (high), class/accessible name (medium),
/// visible text (low). Read-only; never modifies the project. One candidate per
/// file at its best signal, confidence-ranked. Mirrors the Android/RN finders.
class WebSourceCandidateFinder {
  const WebSourceCandidateFinder({
    int maxFileBytes = 1024 * 1024,
    int maxCandidates = 50,
  })  : _maxFileBytes = maxFileBytes,
        _maxCandidates = maxCandidates;

  final int _maxFileBytes;
  final int _maxCandidates;

  static const _minTermLength = 3;
  static const _sourceExtensions = {
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    '.mts',
    '.cts',
    '.vue',
    '.svelte',
    '.astro',
    '.html',
    '.mdx',
    '.css',
    '.scss',
    '.sass',
    '.less',
  };
  static const _skipDirs = {
    'node_modules',
    'dist',
    'build',
    '.next',
    '.nuxt',
    '.svelte-kit',
    'coverage',
    '.git',
    '.idea',
  };

  Future<List<WebSourceCandidate>> find({
    required String projectRoot,
    required WebSelectionSignals signals,
  }) async {
    final terms = _searchTerms(signals);
    if (terms.isEmpty) return const [];

    final candidates = <WebSourceCandidate>[];
    await for (final file in _sourceFiles(Directory(projectRoot))) {
      List<String> lines;
      try {
        if (await file.length() > _maxFileBytes) continue;
        lines = await file.readAsLines();
      } on FileSystemException {
        continue;
      }
      for (final term in terms) {
        final lineIndex = lines.indexWhere(term.pattern.hasMatch);
        if (lineIndex == -1) continue;
        candidates.add(
          WebSourceCandidate(
            path: p.relative(file.path, from: projectRoot),
            line: lineIndex + 1,
            confidence: term.confidence,
            signal: term.signal,
            matchedValue: term.value,
          ),
        );
        break;
      }
    }
    // Sort by confidence FIRST, then cap, so a high-confidence match is never
    // dropped just because it was found late in the traversal.
    candidates.sort((a, b) => a.confidence.index.compareTo(b.confidence.index));
    return candidates.length <= _maxCandidates
        ? candidates
        : candidates.sublist(0, _maxCandidates);
  }

  List<_SearchTerm> _searchTerms(WebSelectionSignals signals) {
    final terms = <_SearchTerm>[];
    void add(
      String? value,
      WebSourceSignal signal,
      WebSourceConfidence confidence,
    ) {
      if (value == null || value.trim().length < _minTermLength) return;
      terms.add(_SearchTerm(value.trim(), signal, confidence));
    }

    add(signals.testId, WebSourceSignal.testId, WebSourceConfidence.high);
    add(signals.domId, WebSourceSignal.domId, WebSourceConfidence.high);
    add(
      signals.className,
      WebSourceSignal.className,
      WebSourceConfidence.medium,
    );
    add(
      signals.accessibleName,
      WebSourceSignal.accessibleName,
      WebSourceConfidence.medium,
    );
    add(signals.text, WebSourceSignal.text, WebSourceConfidence.low);
    return terms;
  }

  Stream<File> _sourceFiles(Directory root) async* {
    if (!root.existsSync()) return;
    await for (final entity in root.list(followLinks: false)) {
      if (entity is Directory) {
        if (_skipDirs.contains(p.basename(entity.path))) continue;
        yield* _sourceFiles(entity);
      } else if (entity is File &&
          _sourceExtensions.contains(p.extension(entity.path))) {
        yield entity;
      }
    }
  }
}

class _SearchTerm {
  _SearchTerm(this.value, this.signal, this.confidence)
      : pattern = RegExp(
          '(?<![A-Za-z0-9_-])${RegExp.escape(value)}(?![A-Za-z0-9_-])',
        );

  final String value;
  final WebSourceSignal signal;
  final WebSourceConfidence confidence;

  /// Matches [value] only when it is not part of a larger identifier or
  /// hyphenated token, so `login` matches `data-testid="login"` and
  /// `id="login"` but not `login-button` or `loginButton`.
  final RegExp pattern;
}
