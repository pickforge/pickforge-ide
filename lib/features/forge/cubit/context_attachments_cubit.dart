import 'dart:io';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/context_attachment.dart';
import 'package:pickforge/core/agent/context_attachment_policy.dart';
import 'package:pickforge/features/forge/cubit/context_attachments_state.dart';

class ContextAttachmentsCubit extends Cubit<ContextAttachmentsState> {
  ContextAttachmentsCubit({
    required String projectRoot,
    ContextAttachmentPolicy policy = const ContextAttachmentPolicy(),
  })  : _policy = policy,
        _projectRoot = p.normalize(p.absolute(projectRoot)),
        super(const ContextAttachmentsState());

  final String _projectRoot;
  final ContextAttachmentPolicy _policy;

  void attach(String path) {
    final absolute = p.normalize(p.absolute(path));
    if (absolute != _projectRoot && !p.isWithin(_projectRoot, absolute)) {
      return;
    }
    final relative = p.relative(absolute, from: _projectRoot).replaceAll(
          r'\',
          '/',
        );
    final blockedReason = _policy.blockedReason(relative);
    if (blockedReason != null) {
      emit(
        state.copyWith(
          lastBlockedPath: relative,
          lastBlockedReason: blockedReason,
        ),
      );
      return;
    }
    final entityType = FileSystemEntity.typeSync(
      absolute,
      followLinks: false,
    );
    if (entityType == FileSystemEntityType.link) {
      emit(
        state.copyWith(
          lastBlockedPath: relative,
          lastBlockedReason: 'blocked: symbolic links are not attachable',
        ),
      );
      return;
    }
    if (entityType != FileSystemEntityType.file) return;
    final file = File(absolute);
    if (!file.existsSync()) return;
    final attachment = ContextAttachment(
      path: absolute,
      relativePath: relative,
      byteLength: file.lengthSync(),
    );
    if (state.attachments.any((item) => item.path == absolute)) return;
    emit(
      state.copyWith(
        attachments: [...state.attachments, attachment],
        clearBlocked: true,
      ),
    );
  }

  void remove(String path) {
    emit(
      state.copyWith(
        attachments:
            state.attachments.where((item) => item.path != path).toList(),
      ),
    );
  }

  void moveUp(String path) {
    final index = state.attachments.indexWhere((item) => item.path == path);
    if (index <= 0) return;
    final next = [...state.attachments];
    final item = next.removeAt(index);
    next.insert(index - 1, item);
    emit(state.copyWith(attachments: next));
  }

  void moveDown(String path) {
    final index = state.attachments.indexWhere((item) => item.path == path);
    if (index == -1 || index >= state.attachments.length - 1) return;
    final next = [...state.attachments];
    final item = next.removeAt(index);
    next.insert(index + 1, item);
    emit(state.copyWith(attachments: next));
  }

  void setCustomNote(String note) {
    emit(state.copyWith(customNote: note.trim()));
  }

  void clearBlockedNotice() {
    emit(state.copyWith(clearBlocked: true));
  }

  void clear() {
    emit(const ContextAttachmentsState());
  }
}
