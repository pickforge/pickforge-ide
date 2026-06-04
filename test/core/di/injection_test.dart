import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/headless/chat_prompt_dispatcher.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter_registry.dart';
import 'package:pickforge/core/agent/headless/headless_chat_feature_flags.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session_pool.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/di/app_bootstrap.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    return getIt.reset();
  });

  test('configureDependencies registers AppBootstrap', () async {
    await configureDependencies();
    expect(getIt<AppBootstrap>().isReady, isTrue);
  });

  test('configureDependencies registers update check services', () async {
    await configureDependencies();

    expect(
      getIt<UpdateCheckSettingsRepository>(),
      isA<UpdateCheckSettingsRepository>(),
    );
    expect(getIt<UpdateCheckService>(), isA<UpdateCheckService>());
  });

  test('configureDependencies registers agent profiles', () async {
    await configureDependencies();

    final ids = getIt<AgentProfileRegistry>()
        .all()
        .map((profile) => profile.id)
        .toSet();

    expect(
      ids,
      containsAll({
        AgentProfileId.claudeCode,
        AgentProfileId.codex,
        AgentProfileId.opencode,
        AgentProfileId.cursor,
        AgentProfileId.gemini,
      }),
    );
  });

  test('configureDependencies registers headless chat services', () async {
    await configureDependencies();

    final registry = getIt<HeadlessChatAdapterRegistry>();
    expect(registry.supports(AgentProfileId.claudeCode), isTrue);
    expect(registry.supports(AgentProfileId.codex), isTrue);
    expect(registry.supports(AgentProfileId.opencode), isTrue);
    expect(
      getIt<HeadlessChatFeatureFlags>().enabled(AgentProfileId.codex),
      isFalse,
    );
    expect(getIt<HeadlessChatSessionPool>(), isA<HeadlessChatSessionPool>());
    expect(getIt<ChatPromptDispatcher>(), isA<ChatPromptDispatcher>());
  });
}
