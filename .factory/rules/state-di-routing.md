# State, DI, and Routing Rules

## State management

- Use `flutter_bloc`/Cubit for feature state.
- Use `freezed` for union states and generated model/state classes where nearby code already does.
- Simple feature state may use manual `Equatable` classes when that matches existing code in the feature.
- Keep async orchestration in Cubits or core services, not directly in widget build methods.

## Dependency injection

- Use `get_it` + `injectable`.
- `configureDependencies()` in `lib/core/di/injection.dart` is the app DI entry point.
- `lib/core/di/injection.config.dart` is generated and tracked.
- Prefer `@injectable` for Cubits and short-lived constructed objects.
- Prefer `@lazySingleton` or module providers for repositories, registries, database access, and long-lived services.
- Some runtime registrations are intentionally manual in `configureDependencies()` when async setup or platform-specific construction is needed.

## Routing

- Use `go_router`.
- Keep route constants in `AppRoutes` and route definitions in `lib/core/router/app_router.dart`.
- The app is bootstrapped with `MaterialApp.router` in `lib/main.dart`.
- Route guards/redirects may use repositories through `getIt`, following the current router pattern.
