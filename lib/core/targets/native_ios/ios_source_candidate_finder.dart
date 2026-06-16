import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;

/// How strongly a source file is believed to relate to an iOS selection.
enum IosSourceConfidence { high, medium, low }

/// Which selection signal produced a source candidate.
enum IosSourceSignal { accessibilityIdentifier, label, text }

/// The searchable strings an iOS selection exposes. Because iOS has no stable
/// external accessibility-hierarchy API, these come from the manual-selection
/// MVP (the user names the element); the search itself is pure and
/// fixture-testable.
class IosSelectionSignals extends Equatable {
  const IosSelectionSignals({
    this.accessibilityIdentifier,
    this.label,
    this.text,
  });

  /// `accessibilityIdentifier` set in code/storyboard (highest confidence).
  final String? accessibilityIdentifier;

  /// Accessibility label.
  final String? label;

  /// Visible text content (lowest confidence).
  final String? text;

  @override
  List<Object?> get props => [accessibilityIdentifier, label, text];
}

/// A likely source file for an iOS selection — NEVER an exact mapping. iOS has
/// no `mapSelectionToSource` capability; this is the best-effort text search.
class IosSourceCandidate extends Equatable {
  const IosSourceCandidate({
    required this.path,
    required this.confidence,
    required this.signal,
    required this.matchedValue,
    this.line,
  });

  /// Project-relative path.
  final String path;
  final int? line;
  final IosSourceConfidence confidence;
  final IosSourceSignal signal;
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

/// Searches an iOS project's Swift/Obj-C/Interface-Builder sources for the
/// values a selected element exposes — `accessibilityIdentifier` (high), label
/// (medium), visible text (low). Read-only; never modifies the project.
/// Confidence-ranked; one candidate per file at its best signal. Mirrors the
/// Android/RN/web finders.
class IosSourceCandidateFinder {
  const IosSourceCandidateFinder({
    int maxFileBytes = 1024 * 1024,
    int maxCandidates = 50,
  })  : _maxFileBytes = maxFileBytes,
        _maxCandidates = maxCandidates;

  final int _maxFileBytes;
  final int _maxCandidates;

  static const _minTermLength = 3;
  static const _sourceExtensions = {
    '.swift',
    '.m',
    '.mm',
    '.h',
    '.xib',
    '.storyboard',
  };
  static const _skipDirs = {
    'build',
    'DerivedData',
    'Pods',
    'Carthage',
    '.build',
    '.git',
    '.swiftpm',
  };

  Future<List<IosSourceCandidate>> find({
    required String projectRoot,
    required IosSelectionSignals signals,
  }) async {
    final terms = _searchTerms(signals);
    if (terms.isEmpty) return const [];

    final candidates = <IosSourceCandidate>[];
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
          IosSourceCandidate(
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

  List<_SearchTerm> _searchTerms(IosSelectionSignals signals) {
    final terms = <_SearchTerm>[];
    void add(
      String? value,
      IosSourceSignal signal,
      IosSourceConfidence confidence,
    ) {
      if (value == null || value.trim().length < _minTermLength) return;
      terms.add(_SearchTerm(value.trim(), signal, confidence));
    }

    add(
      signals.accessibilityIdentifier,
      IosSourceSignal.accessibilityIdentifier,
      IosSourceConfidence.high,
    );
    add(signals.label, IosSourceSignal.label, IosSourceConfidence.medium);
    add(signals.text, IosSourceSignal.text, IosSourceConfidence.low);
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
          '(?<![A-Za-z0-9_])${RegExp.escape(value)}(?![A-Za-z0-9_])',
        );

  final String value;
  final IosSourceSignal signal;
  final IosSourceConfidence confidence;

  /// Matches [value] only when it is not part of a larger identifier, so
  /// `loginButton` matches `accessibilityIdentifier = "loginButton"` but not
  /// `loginButtonTapped`.
  final RegExp pattern;
}
