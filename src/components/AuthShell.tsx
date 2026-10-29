import type { ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { Mascot } from "./Mascot";

/** Mascot + wordmark above a card — the frame every auth screen shares */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView contentContainerClassName="grow justify-center px-5 py-10" keyboardShouldPersistTaps="handled">
          <View className="flex-row items-center gap-3 mb-8 justify-center">
            <Mascot size={44} />
            <Text className="text-on-surface text-xl font-semibold tracking-tight">Nudge Buddy</Text>
          </View>
          <View className="bg-surface-low border border-divider rounded-2xl p-6">
            <Text className="text-on-surface text-2xl font-semibold tracking-tight mb-1">{title}</Text>
            {subtitle ? <Text className="text-outline text-sm mb-6 leading-5">{subtitle}</Text> : <View className="mb-6" />}
            <View className="gap-4">{children}</View>
          </View>
          {footer ? <View className="mt-6 items-center">{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
