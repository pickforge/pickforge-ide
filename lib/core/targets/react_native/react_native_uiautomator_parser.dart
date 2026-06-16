import 'package:pickforge/core/android/android_uiautomator_parser.dart';

// The UIAutomator parser was extracted to the shared Android layer
// (`lib/core/android/`). This alias keeps the React Native call sites stable.
typedef ReactNativeUiAutomatorParser = AndroidUiAutomatorParser;
