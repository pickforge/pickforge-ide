import 'package:equatable/equatable.dart';

class WorkbenchLayoutState extends Equatable {
  const WorkbenchLayoutState({
    required this.projectRoot,
    required this.leftWidth,
    required this.rightWidth,
    required this.rightCollapsed,
  });

  final String? projectRoot;
  final double leftWidth;
  final double rightWidth;
  final bool rightCollapsed;

  static const initial = WorkbenchLayoutState(
    projectRoot: null,
    leftWidth: 220,
    rightWidth: 320,
    rightCollapsed: false,
  );

  WorkbenchLayoutState copyWith({
    String? projectRoot,
    double? leftWidth,
    double? rightWidth,
    bool? rightCollapsed,
  }) =>
      WorkbenchLayoutState(
        projectRoot: projectRoot ?? this.projectRoot,
        leftWidth: leftWidth ?? this.leftWidth,
        rightWidth: rightWidth ?? this.rightWidth,
        rightCollapsed: rightCollapsed ?? this.rightCollapsed,
      );

  @override
  List<Object?> get props =>
      [projectRoot, leftWidth, rightWidth, rightCollapsed];
}
