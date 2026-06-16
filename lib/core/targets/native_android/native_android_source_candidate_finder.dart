import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/android/android_uiautomator_node.dart';

/// How strongly a source file is believed to relate to a selection.
enum NativeAndroidSourceConfidence { high, medium, low }

/// Which selection signal produced a source candidate.
enum NativeAndroidSourceSignal { resourceId, contentDescription, text }

/// A likely source file for a selected node — NEVER an exact mapping.
class NativeAndroidSourceCandidate extends Equatable {
  const NativeAndroidSourceCandidate({
    required this.path,
    required this.confidence,
    required this.signal,
    required this.matchedValue,
    this.line,
  });

  /// Project-relative path.
  final String path;
  final int? line;
  final NativeAndroidSourceConfidence confidence;
  final NativeAndroidSourceSignal signal;
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

/// Searches an Android project's Kotlin/Java/XML sources for the values a
/// selected node exposes — resource-id/testTag (high), accessibility
/// contentDescription (medium), visible text (low). Read-only; never modifies
/// the project. Confidence-ranked; one candidate per file at its best signal.
///
/// The resource-id search covers layout `@+id/foo`, `R.id.foo`, and Compose
/// `testTag("foo")` because they all contain the bare id as a bounded token.
class NativeAndroidSourceCandidateFinder {
  const NativeAndroidSourceCandidateFinder({
    int maxFileBytes = 1024 * 1024,
    int maxCandidates = 50,
  })  : _maxFileBytes = maxFileBytes,
        _maxCandidates = maxCandidates;

  final int _maxFileBytes;
  final int _maxCandidates;

  static const _minTermLength = 3;
  static const _sourceExtensions = {'.kt', '.java', '.xml'};
  static const _skipDirs = {
    'build',
    '.gradle',
    '.git',
    '.idea',
    '.kotlin',
  };

  Future<List<NativeAndroidSourceCandidate>> find({
    required String projectRoot,
    required AndroidA11yNode selectedNode,
  }) async {
    final terms = _searchTerms(selectedNode);
    if (terms.isEmpty) return const [];

    final candidates = <NativeAndroidSourceCandidate>[];
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
          NativeAndroidSourceCandidate(
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
    // Sort by confidence FIRST, then apply the cap, so a high-confidence match
    // is never dropped just because it was found late in the traversal.
    candidates.sort((a, b) => a.confidence.index.compareTo(b.confidence.index));
    return candidates.length <= _maxCandidates
        ? candidates
        : candidates.sublist(0, _maxCandidates);
  }

  List<_SearchTerm> _searchTerms(AndroidA11yNode node) {
    final terms = <_SearchTerm>[];
    void add(
      String? value,
      NativeAndroidSourceSignal signal,
      NativeAndroidSourceConfidence confidence,
    ) {
      if (value == null || value.trim().length < _minTermLength) return;
      terms.add(_SearchTerm(value, signal, confidence));
    }

    add(
      _bareResourceId(node.resourceId),
      NativeAndroidSourceSignal.resourceId,
      NativeAndroidSourceConfidence.high,
    );
    add(
      node.contentDescription,
      NativeAndroidSourceSignal.contentDescription,
      NativeAndroidSourceConfidence.medium,
    );
    add(
      node.text,
      NativeAndroidSourceSignal.text,
      NativeAndroidSourceConfidence.low,
    );
    return terms;
  }

  /// The bare id after the last `/` (`com.app:id/login` → `login`,
  /// `@+id/login` → `login`); a slash-free value is returned unchanged. The
  /// min-length guard then applies to this bare value.
  String? _bareResourceId(String? resourceId) {
    if (resourceId == null || resourceId.isEmpty) return null;
    final slash = resourceId.lastIndexOf('/');
    final bare = slash == -1 ? resourceId : resourceId.substring(slash + 1);
    return bare.isEmpty ? null : bare;
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
  final NativeAndroidSourceSignal signal;
  final NativeAndroidSourceConfidence confidence;

  /// Matches [value] only when it is not part of a larger identifier, so an id
  /// `login` matches `@+id/login` / `R.id.login` / `testTag("login")` but not
  /// `loginButton`.
  final RegExp pattern;
}
