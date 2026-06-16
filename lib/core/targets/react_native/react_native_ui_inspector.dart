import 'package:pickforge/core/android/android_ui_inspector.dart';

// The UI inspector was extracted to the shared Android layer
// (`lib/core/android/`). This alias keeps the React Native call sites stable.
typedef ReactNativeUiInspector = AndroidUiInspector;
