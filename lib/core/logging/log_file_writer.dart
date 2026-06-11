import 'dart:async';
import 'dart:io';

import 'package:path/path.dart' as p;

/// Append-only sink for the current app run's log file.
///
/// One file per process lifetime under [directory]
/// (`pickforge_<timestamp>.log`), with `latest.log` pointing at it. On
/// [open] the directory is pruned to the newest runs so the folder never
/// grows unboundedly; within a run the file is capped so an error loop
/// cannot fill the disk.
///
/// Writes are buffered: lines flush every [flushInterval], immediately when
/// [writeLine] is called with `urgent: true`, and on [close]. The writer
/// knows nothing about log levels or formatting — callers hand it final
/// lines.
class LogFileWriter {
  LogFileWriter({
    required this.directory,
    this.maxRunBytes = 5 * 1024 * 1024,
    this.maxTotalBytes = 20 * 1024 * 1024,
    this.maxRunFiles = 10,
    this.flushInterval = const Duration(seconds: 2),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final Directory directory;
  final int maxRunBytes;
  final int maxTotalBytes;
  final int maxRunFiles;
  final Duration flushInterval;
  final DateTime Function() _now;

  static const latestName = 'latest.log';

  File? _file;
  IOSink? _sink;
  final _buffer = StringBuffer();
  Timer? _flushTimer;
  var _bytesWritten = 0;
  var _capped = false;

  /// The current run's log file; null before [open].
  File? get currentFile => _file;

  Future<void> open() async {
    await directory.create(recursive: true);
    _prune();
    final stamp = _timestamp(_now());
    _file = File(p.join(directory.path, 'pickforge_$stamp.log'));
    _sink = _file!.openWrite(mode: FileMode.append);
    _pointLatestAt(_file!);
  }

  void writeLine(String line, {bool urgent = false}) {
    if (_sink == null || _capped) return;
    _buffer.writeln(line);
    _bytesWritten += line.length + 1;
    if (_bytesWritten > maxRunBytes) {
      _capped = true;
      _buffer.writeln('[log truncated: run exceeded $maxRunBytes bytes]');
      unawaited(flush());
      return;
    }
    if (urgent) {
      unawaited(flush());
      return;
    }
    _flushTimer ??= Timer(flushInterval, () => unawaited(flush()));
  }

  Future<void> flush() async {
    _flushTimer?.cancel();
    _flushTimer = null;
    final sink = _sink;
    if (sink == null || _buffer.isEmpty) return;
    final chunk = _buffer.toString();
    _buffer.clear();
    try {
      sink.write(chunk);
      await sink.flush();
    } on FileSystemException {
      // A full or revoked disk must never crash the app over logging.
    }
  }

  Future<void> close() async {
    await flush();
    try {
      await _sink?.close();
    } on FileSystemException {
      // Best effort.
    }
    _sink = null;
  }

  /// Last [maxLines] lines of the current run, for the support bundle.
  Future<String> tail({int maxLines = 200}) async {
    await flush();
    final file = _file;
    if (file == null || !file.existsSync()) return '';
    final lines = await file.readAsLines();
    final start = lines.length > maxLines ? lines.length - maxLines : 0;
    return lines.sublist(start).join('\n');
  }

  /// Keeps the newest runs within [maxRunFiles] - 1 (one slot is reserved
  /// for the file this run is about to create) and [maxTotalBytes].
  void _prune() {
    final runFiles = directory
        .listSync()
        .whereType<File>()
        .where((f) => p.basename(f.path).startsWith('pickforge_'))
        .toList()
      // Timestamped names sort chronologically; newest first.
      ..sort((a, b) => b.path.compareTo(a.path));
    var totalBytes = 0;
    for (var i = 0; i < runFiles.length; i++) {
      final file = runFiles[i];
      totalBytes += file.lengthSync();
      if (i >= maxRunFiles - 1 || totalBytes > maxTotalBytes) {
        try {
          file.deleteSync();
        } on FileSystemException {
          // Locked or already gone; skip.
        }
      }
    }
  }

  /// Symlinks `latest.log` at the run file; copies nothing. Symlinks can be
  /// unavailable (notably unprivileged Windows), in which case latest.log
  /// simply doesn't exist — the timestamped files remain the source of
  /// truth.
  void _pointLatestAt(File target) {
    final link = Link(p.join(directory.path, latestName));
    try {
      if (link.existsSync()) link.deleteSync();
      link.createSync(p.basename(target.path));
    } on FileSystemException {
      // See doc comment.
    }
  }

  String _timestamp(DateTime t) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${t.year}-${two(t.month)}-${two(t.day)}'
        '_${two(t.hour)}-${two(t.minute)}-${two(t.second)}';
  }
}
