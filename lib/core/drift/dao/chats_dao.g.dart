// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chats_dao.dart';

// ignore_for_file: type=lint
mixin _$ChatsDaoMixin on DatabaseAccessor<PickforgeDatabase> {
  $ProjectsTable get projects => attachedDatabase.projects;
  $ChatsTable get chats => attachedDatabase.chats;
  ChatsDaoManager get managers => ChatsDaoManager(this);
}

class ChatsDaoManager {
  final _$ChatsDaoMixin _db;
  ChatsDaoManager(this._db);
  $$ProjectsTableTableManager get projects =>
      $$ProjectsTableTableManager(_db.attachedDatabase, _db.projects);
  $$ChatsTableTableManager get chats =>
      $$ChatsTableTableManager(_db.attachedDatabase, _db.chats);
}
