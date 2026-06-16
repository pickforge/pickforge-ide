import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';

/// How strongly a source file is believed to relate to a selection.
enum ReactNativeSourceConfidence { high, medium, low }

/// Which selection signal produced a source candidate.
enum ReactNativeSourceSignal { resourceId, contentDescription, text }

/// A likely source file for a selected node — NEVER an exact mapping.
class ReactNativeSourceCandidate extends Equatable {
  const ReactNativeSourceCandidate({
    required this.path,
    required this.confidence,
    required this.signal,
    required this.matchedValue,
    this.line,
  });

  /// Project-relative path.
  final String path;
  final int? line;
  final ReactNativeSourceConfidence confidence;
  final ReactNativeSourceSignal signal;
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

/// Searches a project's JS/TS sources for the values a selected node exposes
/// (testID/resource-id, accessibility label, visible text), returning ranked
/// likely-source candidates. Read-only; never modifies the project.
class ReactNativeSourceCandidateFinder {
  const ReactNativeSourceCandidateFinder({
    int maxFileBytes = 1024 * 1024,
    int maxCandidates = 50,
  })  : _maxFileBytes = maxFileBytes,
        _maxCandidates = maxCandidates;

  final int _maxFileBytes;
  final int _maxCandidates;

  static const _sourceExtensions = {'.js', '.jsx', '.ts', '.tsx'};
  static const _skipDirs = {
    'node_modules',
    'android',
    'ios',
    'build',
    '.git',
    '.expo',
    '.gradle',
  };

  Future<List<ReactNativeSourceCandidate>> find({
    required String projectRoot,
    required ReactNativeA11yNode selectedNode,
  }) async {
    final terms = _searchTerms(selectedNode);
    if (terms.isEmpty) return const [];

    final candidates = <ReactNativeSourceCandidate>[];

    await for (final file in _sourceFiles(Directory(projectRoot))) {
      List<String> lines;
      try {
        if (await file.length() > _maxFileBytes) continue;
        lines = await file.readAsLines();
      } on FileSystemException {
        continue;
      }
      // One candidate per file, at its highest-confidence matching signal
      // (terms are ordered resource-id > label > text).
      for (final term in terms) {
        final lineIndex = lines.indexWhere(term.pattern.hasMatch);
        if (lineIndex == -1) continue;
        candidates.add(
          ReactNativeSourceCandidate(
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
    candidates.sort(
      (a, b) => a.confidence.index.compareTo(b.confidence.index),
    );
    return candidates.length <= _maxCandidates
        ? candidates
        : candidates.sublist(0, _maxCandidates);
  }

  // Below this length a term (e.g. `id`, `ok`) matches too much to be useful.
  static const _minTermLength = 3;

  List<_SearchTerm> _searchTerms(ReactNativeA11yNode node) {
    final terms = <_SearchTerm>[];
    void add(
      String? value,
      ReactNativeSourceSignal signal,
      ReactNativeSourceConfidence confidence,
    ) {
      if (value == null || value.trim().length < _minTermLength) return;
      terms.add(_SearchTerm(value, signal, confidence));
    }

    add(
      _bareResourceId(node.resourceId),
      ReactNativeSourceSignal.resourceId,
      ReactNativeSourceConfidence.high,
    );
    add(
      node.contentDescription,
      ReactNativeSourceSignal.contentDescription,
      ReactNativeSourceConfidence.medium,
    );
    add(
      node.text,
      ReactNativeSourceSignal.text,
      ReactNativeSourceConfidence.low,
    );
    return terms;
  }

  /// The bare id after the last `/` (`com.app:id/login` → `login`); a
  /// slash-free value is returned unchanged. The min-length guard then applies
  /// to this bare value.
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
  final ReactNativeSourceSignal signal;
  final ReactNativeSourceConfidence confidence;

  /// Matches [value] only when it is not part of a larger identifier, so a
  /// testID `login` matches `"login"` but not `loginButton`.
  final RegExp pattern;
}
