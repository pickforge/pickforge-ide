import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/json_rpc_line_decoder.dart';

void main() {
  test('decodes one envelope per JSON line', () {
    final dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('[{"event":"app.start","params":{"appId":"abc"}}]\n', outs.add);
    expect(outs, hasLength(1));
    expect(outs.first, isA<DecodedEnvelope>());
    final env = outs.first as DecodedEnvelope;
    expect(env.event, 'app.start');
    expect(env.params['appId'], 'abc');
  });

  test('passes plain non-JSON lines through as raw', () {
    final dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('Launching lib/main.dart on Pixel_5...\n', outs.add);
    expect(outs.single, isA<DecodedRawLine>());
    expect(
      (outs.single as DecodedRawLine).text,
      'Launching lib/main.dart on Pixel_5...',
    );
  });

  test('handles multiple envelopes in one chunk', () {
    final dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    final body = '${jsonEncode([
          {'event': 'app.start', 'params': {}},
        ])}\n'
        '${jsonEncode([
          {
            'event': 'app.started',
            'params': {'vmServiceUri': 'ws://x'},
          },
        ])}\n';
    dec.feed(body, outs.add);
    expect(outs, hasLength(2));
    expect((outs[1] as DecodedEnvelope).event, 'app.started');
  });

  test('buffers partial lines across chunks', () {
    final dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('[{"event":"app.s', outs.add);
    expect(outs, isEmpty);
    dec.feed('tart","params":{}}]\n', outs.add);
    expect(outs, hasLength(1));
    expect((outs.single as DecodedEnvelope).event, 'app.start');
  });

  test('decodes plain JSON-RPC response (response to our request)', () {
    final dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('[{"id":42,"result":{"code":0}}]\n', outs.add);
    expect(outs.single, isA<DecodedResponse>());
    final r = outs.single as DecodedResponse;
    expect(r.id, 42);
    expect(r.result, {'code': 0});
  });
}
