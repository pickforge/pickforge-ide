import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/headless/claude_code_stream_json_adapter.dart';
import 'package:pickforge/core/agent/headless/codex_exec_json_adapter.dart';
import 'package:pickforge/core/agent/headless/opencode_run_json_adapter.dart';

void main() {
  group('ClaudeCodeStreamJsonAdapter', () {
    const adapter = ClaudeCodeStreamJsonAdapter();

    test('builds stream-json print invocation', () {
      expect(
        adapter.argumentsForPrompt('fix it', resumeSessionId: 's1'),
        ['-p', 'fix it', '--output-format', 'stream-json', '--resume', 's1'],
      );
    });

    test('parses assistant content blocks', () {
      final message = adapter.parseJsonLine(
        jsonEncode({
          'type': 'assistant',
          'message': {
            'content': [
              {'type': 'text', 'text': 'ready'},
            ],
          },
        }),
      );

      expect(message?.role, ChatMessageRole.assistant);
      expect(message?.text, 'ready');
    });

    test('parses stream deltas', () {
      final message = adapter.parseJsonLine(
        jsonEncode({
          'type': 'stream_event',
          'event': {
            'type': 'content_block_delta',
            'delta': {'type': 'text_delta', 'text': 'part'},
          },
        }),
      );

      expect(message?.role, ChatMessageRole.assistant);
      expect(message?.text, 'part');
    });
  });

  group('CodexExecJsonAdapter', () {
    const adapter = CodexExecJsonAdapter();

    test('builds exec json invocation', () {
      expect(
        adapter.argumentsForPrompt('fix it'),
        [
          'exec',
          '--json',
          '--sandbox',
          'workspace-write',
          '--ask-for-approval',
          'never',
          'fix it',
        ],
      );
    });

    test('parses agent messages', () {
      final message = adapter.parseJsonLine(
        jsonEncode({
          'type': 'item.completed',
          'item': {'type': 'agent_message', 'text': 'done'},
        }),
      );

      expect(message?.role, ChatMessageRole.assistant);
      expect(message?.text, 'done');
    });

    test('parses failures', () {
      final message = adapter.parseJsonLine(
        jsonEncode({
          'type': 'turn.failed',
          'error': {'message': 'denied'},
        }),
      );

      expect(message?.role, ChatMessageRole.error);
      expect(message?.text, 'denied');
    });
  });

  group('OpenCodeRunJsonAdapter', () {
    const adapter = OpenCodeRunJsonAdapter();

    test('builds run json invocation', () {
      expect(
        adapter.argumentsForPrompt('fix it'),
        ['run', '--format', 'json', 'fix it'],
      );
    });

    test('parses assistant role events', () {
      final message = adapter.parseJsonLine(
        jsonEncode({
          'type': 'message',
          'role': 'assistant',
          'message': {'content': 'patched'},
        }),
      );

      expect(message?.role, ChatMessageRole.assistant);
      expect(message?.text, 'patched');
    });

    test('falls back to system messages for non-json stdout', () {
      final message = adapter.parseJsonLine('warning');

      expect(message?.role, ChatMessageRole.system);
      expect(message?.text, 'warning');
    });
  });
}
