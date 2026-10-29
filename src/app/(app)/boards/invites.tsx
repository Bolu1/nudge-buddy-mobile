import { ScrollView } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { router } from "expo-router";
import { IconButton, ScreenHeader } from "@/components/ui";
import { InvitesList } from "@/components/boards/InvitesList";

// Landing screen for the link in invite emails / invite notifications
export default function BoardInvitesScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader title="Board invites" left={<IconButton name="chevron-left" onPress={() => (router.canGoBack() ? router.back() : router.replace("/boards"))} accessibilityLabel="Back" />} />
      <ScrollView contentContainerClassName="p-4 pb-32">
        <InvitesList showEmpty onAccepted={(id) => router.replace({ pathname: "/boards/[boardId]", params: { boardId: id } })} />
      </ScrollView>
    </SafeAreaView>
  );
}
