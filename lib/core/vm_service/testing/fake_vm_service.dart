import 'dart:convert';
import 'dart:io';

class FakeVmServiceScript {
  FakeVmServiceScript(this._entries);

  final List<Map<String, dynamic>> _entries;
  int _cursor = 0;

  static Future<FakeVmServiceScript> loadFromFile(String path) async {
    final lines = await File(path).readAsLines();
    final entries = lines
        .where((line) => line.trim().isNotEmpty)
        .map((line) => json.decode(line) as Map<String, dynamic>)
        .toList();
    return FakeVmServiceScript(entries);
  }

  Map<String, dynamic> respondTo(String method) {
    if (_cursor >= _entries.length) {
      throw StateError('No scripted response for method "$method"');
    }
    if (_cursor >= _entries.length) {
      throw StateError('No scripted response for method "$method"');
    }
    var entry = _entries[_cursor];
    if (entry['type'] == 'request') {
      if (entry['method'] != method) {
        throw StateError('Expected ${entry['method']}, got "$method"');
      }
      final requestId = entry['id'];
      _cursor++;
      if (_cursor >= _entries.length) {
        throw StateError('No scripted response for method "$method"');
      }
      entry = _entries[_cursor];
      while (entry['type'] == 'event') {
        _cursor++;
        if (_cursor >= _entries.length) {
          throw StateError('No scripted response for method "$method"');
        }
        entry = _entries[_cursor];
      }
      if (requestId != null && entry['id'] != requestId) {
        throw StateError('Expected response id $requestId, got ${entry['id']}');
      }
    }
    final responseMethod = entry['method'];
    if (entry['type'] != 'response' ||
        (responseMethod != null && responseMethod != method)) {
      throw StateError('Expected ${entry['method']}, got "$method"');
    }
    _cursor++;
    return (entry['result'] as Map).cast<String, dynamic>();
  }

  Map<String, dynamic> consumeEvent(String streamId) {
    if (_cursor >= _entries.length) {
      throw StateError('No scripted event for stream "$streamId"');
    }
    final entry = _entries[_cursor];
    if (entry['type'] != 'event' || entry['streamId'] != streamId) {
      throw StateError('Expected ${entry['streamId']}, got "$streamId"');
    }
    _cursor++;
    return entry;
  }
}
