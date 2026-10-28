import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

// Uniwind only styles React Native's own components — third-party ones need
// wrapping before `className` does anything.
export const SafeAreaView = withUniwind(RNSafeAreaView);
