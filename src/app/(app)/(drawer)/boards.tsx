import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { router } from "expo-router";
import { boards as boardsApi } from "@/lib/api";
import { ROLE_LABEL, unwrap, type BoardSummary } from "@/lib/boards";
import { onChange } from "@/lib/events";
import { colors } from "@/lib/theme";
import { useWs } from "@/lib/ws-context";
import { Avatar } from "@/components/Avatar";
import { BoardFormSheet } from "@/components/boards/BoardFormSheet";
import { InvitesList } from "@/components/boards/InvitesList";
import { Button, ScreenHeader, SectionTitle } from "@/components/ui";

const MAX_AVATARS = 5;

function MemberStack({ members, total }: { members: BoardSummary["memberPreview"]; total: number }) {
  const shown = members.slice(0, MAX_AVATARS);
  const extra = total - shown.length;
  return (
    <View className="flex-row items-center">
      {shown.map((m, i) => (
        <View key={m.id} style={{ marginLeft: i ? -6 : 0 }}>
          <Avatar id={m.id} firstName={m.firstName} lastName={m.lastName} size={24} ring={colors.surfaceLow} />
        </View>
      ))}
      {extra > 0 ? (
        <View className="h-6 min-w-6 px-1 rounded-full bg-surface-high items-center justify-center border-2 border-surface-low" style={{ marginLeft: -6 }}>
          <Text className="text-on-surface-variant text-[11px] font-semibold">+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function BoardsScreen() {
  const { addListener } = useWs();
  const [list, setList] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await boardsApi.list();
    if (res.ok) setList(unwrap<BoardSummary[]>(res) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    return onChange("boards", load);
  }, [load]);

  // Counts change when anyone edits a board
  useEffect(() => addListener((msg) => { if (msg.type === "board_updated") load(); }), [addListener, load]);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader
        title="Boards"
        subtitle="Shared task lists with other people"
        right={<Button title="New board" icon="plus" variant="tonal" size="sm" onPress={() => setCreating(true)} />}
      />
      <ScrollView
        contentContainerClassName="p-4 gap-8 pb-32"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
      >
        <InvitesList onAccepted={(id) => router.push({ pathname: "/boards/[boardId]", params: { boardId: id } })} />
        <View>
          <SectionTitle>Your boards</SectionTitle>
          {loading ? (
            <View className="gap-3">{[1, 2].map((i) => <View key={i} className="h-28 bg-surface-low border border-divider rounded-2xl" />)}</View>
          ) : list.length === 0 ? (
            <View className="rounded-2xl bg-surface-low border border-divider p-8 items-center">
              <Text className="text-on-surface-variant text-sm font-medium">No boards yet</Text>
              <Text className="text-outline text-sm mt-1 text-center">Create one and invite people by email to share tasks.</Text>
            </View>
          ) : (
            <View className="gap-3">
              {list.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => router.push({ pathname: "/boards/[boardId]", params: { boardId: b.id } })}
                  className="bg-surface-low border border-divider active:border-outline-variant rounded-2xl p-4 gap-3"
                >
                  <View className="flex-row items-center gap-2">
                    <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color ?? "#8da38a" }} />
                    <Text className="text-on-surface text-sm font-medium flex-1" numberOfLines={1}>{b.name}</Text>
                    <Text className="text-outline text-[11px]">{ROLE_LABEL[b.role]}</Text>
                  </View>
                  <Text className="text-outline text-xs leading-5" numberOfLines={2}>{b.description || "No description"}</Text>
                  <View className="flex-row items-center justify-between">
                    <MemberStack members={b.memberPreview} total={b.memberCount} />
                    <Text className="text-outline text-xs">{b.openTaskCount} open</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <BoardFormSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onSaved={(b) => {
          setCreating(false);
          load();
          if (b.id) router.push({ pathname: "/boards/[boardId]", params: { boardId: b.id } });
        }}
      />
    </SafeAreaView>
  );
}
