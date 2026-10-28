/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "widget",
  name: "NudgeWidgets",
  displayName: "Nudge Buddy",
  // Live Activities (Dynamic Island + lock screen) need iOS 16.1+
  deploymentTarget: "16.4",
  bundleIdentifier: ".widgets",
  frameworks: ["SwiftUI", "ActivityKit", "WidgetKit"],
  colors: {
    $accent: "#8da38a",
    $widgetBackground: "#151311",
  },
});
