import 'package:pickforge/core/android/android_adb_service.dart';

// ADB support was extracted to the shared Android layer (`lib/core/android/`).
// These aliases keep the React Native call sites stable.
typedef ReactNativeBinaryProcessRunner = AndroidBinaryProcessRunner;
typedef RunningAndroidDevice = AndroidAdbDevice;
typedef ReactNativeAdbService = AndroidAdbService;
