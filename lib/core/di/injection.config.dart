// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format width=80

// **************************************************************************
// InjectableConfigGenerator
// **************************************************************************

// ignore_for_file: type=lint
// coverage:ignore-file

// ignore_for_file: no_leading_underscores_for_library_prefixes
import 'package:get_it/get_it.dart' as _i174;
import 'package:injectable/injectable.dart' as _i526;
import 'package:pickforge/core/di/app_bootstrap.dart' as _i536;
import 'package:pickforge/core/drift/pickforge_database.dart' as _i631;
import 'package:pickforge/core/settings/project_settings_repository.dart'
    as _i340;
import 'package:pickforge/core/vm_service/vm_service_client.dart' as _i292;

extension GetItInjectableX on _i174.GetIt {
// initializes the registration of main-scope dependencies inside of GetIt
  _i174.GetIt init({
    String? environment,
    _i526.EnvironmentFilter? environmentFilter,
  }) {
    final gh = _i526.GetItHelper(
      this,
      environment,
      environmentFilter,
    );
    gh.lazySingleton<_i536.AppBootstrap>(() => _i536.AppBootstrap());
    gh.lazySingleton<_i631.PickforgeDatabase>(() => _i631.PickforgeDatabase());
    gh.lazySingleton<_i292.VmServiceClient>(() => _i292.VmServiceClient());
    gh.lazySingleton<_i340.ProjectSettingsRepository>(
        () => _i340.ProjectSettingsRepository(gh<_i631.PickforgeDatabase>()));
    return this;
  }
}
