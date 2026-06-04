import 'package:pickforge/core/inspector/models.dart';
import 'package:vm_service/vm_service.dart';

class RebuildStatsDecoder {
  final _knownLocations = <int, _RebuildLocation>{};

  RebuildStats? decode(Event event) {
    if (event.extensionKind != 'Flutter.RebuiltWidgets') return null;
    final data = event.extensionData?.data;
    if (data == null) return null;

    _ingestLocations(data['locations']);

    final rawEvents = data['events'];
    if (rawEvents is! List) return null;

    final widgets = <RebuiltWidget>[];
    for (var i = 0; i + 1 < rawEvents.length; i += 2) {
      final id = _asInt(rawEvents[i]);
      final count = _asInt(rawEvents[i + 1]);
      if (id == null || count == null) continue;
      final location = _knownLocations[id];
      if (location == null) continue;
      widgets.add(
        RebuiltWidget(
          className: location.name,
          location: CreationLocation(
            file: location.file,
            line: location.line,
            column: location.column,
          ),
          count: count,
        ),
      );
    }

    widgets.sort((a, b) {
      final byCount = b.count.compareTo(a.count);
      if (byCount != 0) return byCount;
      final byFile = a.location.file.compareTo(b.location.file);
      if (byFile != 0) return byFile;
      return a.location.line.compareTo(b.location.line);
    });

    return RebuildStats(
      frameNumber: _asInt(data['frameNumber']),
      startTime: _asInt(data['startTime']),
      widgets: widgets,
    );
  }

  void _ingestLocations(Object? raw) {
    if (raw is! Map) return;
    for (final fileEntry in raw.entries) {
      final file = fileEntry.key?.toString();
      final value = fileEntry.value;
      if (file == null || value is! Map) continue;

      final ids = value['ids'];
      final lines = value['lines'];
      final columns = value['columns'];
      final names = value['names'];
      if (ids is! List ||
          lines is! List ||
          columns is! List ||
          names is! List) {
        continue;
      }

      final count = _shortestLength([ids, lines, columns, names]);
      for (var i = 0; i < count; i++) {
        final id = _asInt(ids[i]);
        final line = _asInt(lines[i]);
        final column = _asInt(columns[i]);
        final name = names[i]?.toString();
        if (id == null || line == null || column == null || name == null) {
          continue;
        }
        _knownLocations[id] = _RebuildLocation(
          file: file,
          line: line,
          column: column,
          name: name,
        );
      }
    }
  }

  int _shortestLength(List<List<dynamic>> lists) {
    var length = lists.first.length;
    for (final list in lists.skip(1)) {
      if (list.length < length) length = list.length;
    }
    return length;
  }

  int? _asInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}

class _RebuildLocation {
  const _RebuildLocation({
    required this.file,
    required this.line,
    required this.column,
    required this.name,
  });

  final String file;
  final int line;
  final int column;
  final String name;
}
