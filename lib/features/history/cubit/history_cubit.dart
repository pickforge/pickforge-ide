import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

@injectable
class HistoryCubit extends Cubit<List<PickHistoryRow>> {
  HistoryCubit(this._db) : super(const []) {
    _db.pickHistoryDao.recent().listen(emit);
  }

  final PickforgeDatabase _db;
}
