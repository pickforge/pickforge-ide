import 'package:equatable/equatable.dart';

class WorkbenchLayoutState extends Equatable {
  const WorkbenchLayoutState({
    required this.projectRoot,
    required this.leftWidth,
    required this.rightWidth,
    required this.rightCollapsed,
    required this.runLogsHeight,
    required this.runLogsCollapsed,
  });

  final String? projectRoot;
  final double leftWidth;
  final double rightWidth;
  final bool rightCollapsed;
  final double runLogsHeight;
  final bool runLogsCollapsed;

  static const initial = WorkbenchLayoutState(
    projectRoot: null,
    leftWidth: 220,
    rightWidth: 320,
    rightCollapsed: false,
    runLogsHeight: 220,
    runLogsCollapsed: true,
  );

  WorkbenchLayoutState copyWith({
    String? projectRoot,
    double? leftWidth,
    double? rightWidth,
    bool? rightCollapsed,
    double? runLogsHeight,
    bool? runLogsCollapsed,
  }) =>
      WorkbenchLayoutState(
        projectRoot: projectRoot ?? this.projectRoot,
        leftWidth: leftWidth ?? this.leftWidth,
        rightWidth: rightWidth ?? this.rightWidth,
        rightCollapsed: rightCollapsed ?? this.rightCollapsed,
        runLogsHeight: runLogsHeight ?? this.runLogsHeight,
        runLogsCollapsed: runLogsCollapsed ?? this.runLogsCollapsed,
      );

  @override
  List<Object?> get props => [
        projectRoot,
        leftWidth,
        rightWidth,
        rightCollapsed,
        runLogsHeight,
        runLogsCollapsed,
      ];
}
