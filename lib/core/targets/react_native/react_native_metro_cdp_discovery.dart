import 'package:pickforge/core/cdp/cdp_discovery.dart';

export 'package:pickforge/core/cdp/cdp_discovery.dart';

// CDP discovery was extracted to the shared `lib/core/cdp/` layer (a `/json/list`
// endpoint is the same whether it's Metro's inspector proxy or a browser debug
// port). These aliases + the React Native / Hermes extensions keep the existing
// Metro call sites stable.
typedef MetroHttpFetcher = CdpHttpFetcher;
typedef MetroCdpTarget = CdpTarget;
typedef MetroCdpDiscovery = CdpDiscovery;

const CdpHttpFetcher defaultMetroHttpFetcher = defaultCdpHttpFetcher;

extension MetroCdpTargetX on CdpTarget {
  /// A connectable React Native / Hermes JS debugger target.
  bool get isReactNativeHermesDebuggerTarget {
    final url = webSocketDebuggerUrl;
    if (url == null || url.isEmpty) return false;
    final haystack = '$title $description $vm'.toLowerCase();
    return type == 'node' ||
        haystack.contains('react native') ||
        haystack.contains('hermes');
  }
}

extension MetroCdpDiscoveryX on CdpDiscovery {
  /// The first connectable React Native / Hermes target, if any.
  Future<CdpTarget?> discoverReactNativeTarget() async {
    for (final target in await discoverTargets()) {
      if (target.isReactNativeHermesDebuggerTarget) return target;
    }
    return null;
  }
}
