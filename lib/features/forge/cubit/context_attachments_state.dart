import 'package:equatable/equatable.dart';
import 'package:pickforge/core/agent/context_attachment.dart';

class ContextAttachmentsState extends Equatable {
  const ContextAttachmentsState({
    this.attachments = const [],
    this.customNote = '',
    this.lastBlockedPath,
    this.lastBlockedReason,
  });

  final List<ContextAttachment> attachments;
  final String customNote;
  final String? lastBlockedPath;
  final String? lastBlockedReason;

  int get totalBytes => attachments.fold<int>(
        customNote.length,
        (sum, attachment) => sum + attachment.byteLength,
      );

  ContextAttachmentsState copyWith({
    List<ContextAttachment>? attachments,
    String? customNote,
    String? lastBlockedPath,
    String? lastBlockedReason,
    bool clearBlocked = false,
  }) =>
      ContextAttachmentsState(
        attachments: attachments ?? this.attachments,
        customNote: customNote ?? this.customNote,
        lastBlockedPath:
            clearBlocked ? null : lastBlockedPath ?? this.lastBlockedPath,
        lastBlockedReason:
            clearBlocked ? null : lastBlockedReason ?? this.lastBlockedReason,
      );

  @override
  List<Object?> get props => [
        attachments,
        customNote,
        lastBlockedPath,
        lastBlockedReason,
      ];
}
