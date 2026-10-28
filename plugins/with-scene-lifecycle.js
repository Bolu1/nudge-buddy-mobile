// iOS 27 refuses to launch apps that haven't adopted the scene-based life
// cycle (UIKit asserts in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
// Expo SDK 57 ships ExpoAppSceneDelegate for this, but the prebuild template
// still uses the app-delegate window. This plugin switches the generated
// project over:
//   - AppDelegate conforms to ExpoReactNativeFactoryProvider and no longer
//     creates the window — the scene delegate does, then starts React Native.
//   - Info.plist registers EXExpoAppSceneDelegate as the window scene delegate.
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const WINDOW_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n    window = UIWindow\(frame: UIScreen\.main\.bounds\)\n    factory\.startReactNative\(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions\)\n#endif\n/;

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") {
      throw new Error("with-scene-lifecycle: expected a Swift AppDelegate");
    }
    let src = c.modResults.contents;
    if (!src.includes("ExpoReactNativeFactoryProvider")) {
      src = src.replace(
        "class AppDelegate: ExpoAppDelegate {",
        "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
      );
    }
    if (WINDOW_BLOCK.test(src)) {
      src = src.replace(
        WINDOW_BLOCK,
        "\n    // The window is created by ExpoAppSceneDelegate (scene life cycle), which\n    // then starts React Native with this factory.\n",
      );
    } else if (src.includes("window = UIWindow(frame: UIScreen.main.bounds)")) {
      throw new Error("with-scene-lifecycle: AppDelegate window setup changed — update the plugin");
    }
    c.modResults.contents = src;
    return c;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "EXExpoAppSceneDelegate",
          },
        ],
      },
    };
    return c;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneManifest(withSceneAppDelegate(config));
};
