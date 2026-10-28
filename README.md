# nudge-buddy-mobile

React Native (Expo) app for Nudge Buddy: voice buddy with background calls, tasks, workday, boards, brain dump, focus, calendar and insights. Uses the Dynamic Island and Live Activities on iOS, and live-update notifications on Android.

## Setup

```sh
npm install
cp .env.example .env   # point EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WEB_URL at your machine's LAN IP
```

Native modules (`modules/voice-engine`, `modules/live-activity`) and the widget target (`targets/widget`) mean this needs a **dev build**. Expo Go will not work.

```sh
npx expo run:ios                 # simulator
npx expo run:ios --device        # iPhone (set APPLE_TEAM_ID, IOS_BUNDLE_ID)
npx expo start --dev-client      # Metro only, for an installed dev build
```

With a free Apple ID (Personal Team), set `IOS_PUSH=off`. This drops the push entitlement, so remote push, VoIP calls and Live Activity push updates are disabled. Local Live Activities still work.

## Layout

- `src/app`: expo-router routes, with a drawer for the main screens
- `src/components`, `src/lib`: UI and app logic (voice pipeline, websocket, Live Activities)
- `modules/`: local Expo native modules (Swift + Kotlin)
- `targets/widget`: Live Activity / Dynamic Island widget
- `plugins/`: config plugins (iOS scene lifecycle)
