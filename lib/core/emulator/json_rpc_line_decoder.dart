import 'dart:convert';

sealed class DecodedLine {
  const DecodedLine();
}

class DecodedEnvelope extends DecodedLine {
  const DecodedEnvelope({required this.event, required this.params});

  final String event;
  final Map<String, dynamic> params;
}

class DecodedResponse extends DecodedLine {
  const DecodedResponse({required this.id, this.result, this.error});

  final int id;
  final Object? result;
  final Object? error;
}

class DecodedRawLine extends DecodedLine {
  const DecodedRawLine(this.text);

  final String text;
}

class JsonRpcLineDecoder {
  final _buffer = StringBuffer();
  String _cached = '';

  void feed(String chunk, void Function(DecodedLine) sink) {
    _buffer.write(chunk);
    _cached = _buffer.toString();
    while (true) {
      final idx = _cached.indexOf('\n');
      if (idx < 0) return;
      final line = _cached.substring(0, idx).trimRight();
      final rest = _cached.substring(idx + 1);
      _buffer
        ..clear()
        ..write(rest);
      _cached = rest;
      if (line.isNotEmpty) sink(_decodeLine(line));
    }
  }

  DecodedLine _decodeLine(String line) {
    if (!line.startsWith('[') && !line.startsWith('{')) {
      return DecodedRawLine(line);
    }
    try {
      final decoded = jsonDecode(line);
      if (decoded is List && decoded.length == 1 && decoded.first is Map) {
        return _fromMap((decoded.first as Map).cast<String, dynamic>());
      }
      if (decoded is Map) return _fromMap(decoded.cast<String, dynamic>());
      return DecodedRawLine(line);
    } on FormatException {
      return DecodedRawLine(line);
    }
  }

  DecodedLine _fromMap(Map<String, dynamic> map) {
    if (map.containsKey('event')) {
      return DecodedEnvelope(
        event: map['event'] as String,
        params: (map['params'] as Map?)?.cast<String, dynamic>() ?? const {},
      );
    }
    if (map.containsKey('id')) {
      return DecodedResponse(
        id: map['id'] as int,
        result: map['result'],
        error: map['error'],
      );
    }
    return DecodedRawLine(jsonEncode(map));
  }
}
