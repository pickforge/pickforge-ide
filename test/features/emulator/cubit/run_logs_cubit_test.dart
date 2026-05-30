import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_state.dart';

void main() {
  test('appends events up to cap', () {
    final cubit = RunLogsCubit(cap: 3);
    for (var i = 0; i < 5; i++) {
      cubit.append(RunSessionEvent.log(line: 'line-$i', level: LogLevel.info));
    }
    expect(cubit.state.entries.length, 3);
    expect(cubit.state.entries.first.line, 'line-2');
  });

  test('setFilter filters visible entries', () {
    final cubit = RunLogsCubit()
      ..append(const RunSessionEvent.log(line: 'a', level: LogLevel.info))
      ..append(const RunSessionEvent.log(line: 'b', level: LogLevel.error))
      ..setFilter(LogFilter.errors);
    expect(cubit.state.visibleEntries.length, 1);
    expect(cubit.state.visibleEntries.first.line, 'b');
  });

  test('clear empties buffer', () {
    final cubit = RunLogsCubit()
      ..append(const RunSessionEvent.log(line: 'a', level: LogLevel.info))
      ..clear();
    expect(cubit.state.entries, isEmpty);
  });
}
