import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/ansi.dart';

class TranscriptRecorder {
  TranscriptRecorder({
    required this.projectRoot,
    required this.chatId,
    this.maxBytes = 5 * 1024 * 1024,
    int? truncateAt,
  }) : truncateAt = truncateAt ?? (maxBytes + (1024 * 1024));

  final String projectRoot;
  final String chatId;
  final int maxBytes;
  final int truncateAt;

  late final String _dir = p.join(projectRoot, '.pickforge', 'chats', chatId);
  late final File _log = File(p.join(_dir, 'transcript.log'));
  late final File _spans = File(p.join(_dir, 'transcript.spans.bin'));
  late final File _meta = File(p.join(_dir, 'meta.json'));
  IOSink? _logSink;
  IOSink? _spansSink;

  Future<void> open() async {
    await Directory(_dir).create(recursive: true);
    _logSink = _log.openWrite(mode: FileMode.append);
    _spansSink = _spans.openWrite(mode: FileMode.append);
  }

  void append(Object data) {
    final raw = data is String
        ? data
        : utf8.decode(data as List<int>, allowMalformed: true);
    final r = parseAnsi(raw);
    _logSink?.add(utf8.encode(r.text));
    for (final s in r.spans) {
      _spansSink?.add(_encodeSpan(s));
    }
  }

  List<int> _encodeSpan(AnsiSpan s) {
    final style = (s.bold ? 1 : 0) | (s.italic ? 2 : 0) | (s.underline ? 4 : 0);
    return [
      ..._varint(s.start),
      ..._varint(s.end - s.start),
      ..._varint(s.fg ?? 255),
      ..._varint(s.bg ?? 255),
      ..._varint(style),
    ];
  }

  List<int> _varint(int value) {
    final out = <int>[];
    var v = value;
    while (v >= 0x80) {
      out.add((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.add(v);
    return out;
  }

  Future<void> flush() async {
    await _logSink?.flush();
    await _spansSink?.flush();
    await _maybeTruncate();
    await _writeMeta();
  }

  Future<void> close() async {
    await flush();
    await _logSink?.close();
    await _spansSink?.close();
    _logSink = null;
    _spansSink = null;
  }

  Future<void> _maybeTruncate() async {
    if (!_log.existsSync()) return;
    final size = _log.lengthSync();
    if (size <= truncateAt) return;
    final bytes = _log.readAsBytesSync();
    final keep = bytes.sublist(bytes.length - maxBytes);
    await _log.writeAsBytes(keep, flush: true);
  }

  Future<void> _writeMeta() async {
    final size = _log.existsSync() ? _log.lengthSync() : 0;
    final json = jsonEncode({
      'schemaVersion': 1,
      'bytes': size,
      'updatedAt': DateTime.now().toIso8601String(),
    });
    await _meta.writeAsString(json, flush: true);
  }
}
