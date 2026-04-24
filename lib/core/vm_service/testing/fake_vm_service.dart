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
    while (_cursor < _entries.length && _entries[_cursor]['type'] == 'event') {
      _cursor++;
    }
    if (_cursor >= _entries.length) {
      throw StateError('No scripted response for method "$method"');
    }
    var entry = _entries[_cursor++];
    if (entry['type'] == 'request') {
      if (entry['method'] != method) {
        throw StateError('Expected ${entry['method']}, got "$method"');
      }
      if (_cursor >= _entries.length) {
        throw StateError('No scripted response for method "$method"');
      }
      entry = _entries[_cursor++];
    }
    if (entry['type'] != 'response' || entry['method'] != method) {
      throw StateError('Expected ${entry['method']}, got "$method"');
    }
    return (entry['result'] as Map).cast<String, dynamic>();
  }
}
