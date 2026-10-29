import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { LayoutAnimationConfig } from "react-native-reanimated";
import { router } from "expo-router";
import { flashcards as flashcardsApi } from "@/lib/api";
import { unwrap } from "@/lib/boards";
import { onChange } from "@/lib/events";
import { SCORE_COLOR, scoreTone, type CollectionSummary } from "@/lib/flashcards";
import { colors } from "@/lib/theme";
import { CollectionFormSheet } from "@/components/flashcards/CollectionFormSheet";
import { ThemeBackground } from "@/components/flashcards/ThemeBackground";
import { Mascot } from "@/components/Mascot";
import { Button, ListItem, ScreenHeader, SectionTitle } from "@/components/ui";

function openCollection(id: string) {
  router.push({ pathname: "/flashcards/[collectionId]", params: { collectionId: id } });
}

export default function FlashcardsScreen() {
  const [list, setList] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await flashcardsApi.list();
    if (res.ok) setList(unwrap<CollectionSummary[]>(res) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    return onChange("flashcards", load);
  }, [load]);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg">
      <ScreenHeader
        title="Flashcards"
        subtitle="Study collections and track your score"
        right={<Button title="New" icon="plus" variant="tonal" size="sm" onPress={() => setCreating(true)} />}
      />
      <ScrollView
        contentContainerClassName="p-4 pb-32"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primaryContainer} />}
      >
        <SectionTitle>Your collections</SectionTitle>
        {loading ? (
          <View className="gap-3">{[1, 2].map((i) => <View key={i} className="h-40 bg-surface-low border border-divider rounded-2xl" />)}</View>
        ) : list.length === 0 ? (
          <View className="rounded-2xl bg-surface-low border border-divider p-8 items-center">
            <View className="mb-3"><Mascot size={56} animated /></View>
            <Text className="text-on-surface-variant text-sm font-medium">No collections yet</Text>
            <Text className="text-outline text-sm mt-1 text-center">Create one, add up to 50 cards, then test yourself.</Text>
          </View>
        ) : (
          <View className="gap-3">
            <LayoutAnimationConfig skipEntering>
            {list.map((c) => (
              <ListItem key={c.id}>
              <Pressable
                onPress={() => openCollection(c.id)}
                className="bg-surface-low border border-divider active:border-outline-variant rounded-2xl overflow-hidden"
              >
                <View className="h-20">
                  <ThemeBackground theme={c.theme} seed={c.id} />
                </View>
                <View className="p-4 gap-1.5">
                  <Text className="text-on-surface text-sm font-medium" numberOfLines={1}>{c.title}</Text>
                  {c.description ? <Text className="text-outline text-xs leading-5" numberOfLines={2}>{c.description}</Text> : null}
                  <View className="flex-row items-center justify-between mt-1">
                    <Text className="text-outline text-xs">
                      {c.cardCount} card{c.cardCount === 1 ? "" : "s"}
                    </Text>
                    <Text
                      className="text-outline text-xs"
                      style={c.lastSession ? { color: SCORE_COLOR[scoreTone(c.lastSession.scorePct)] } : undefined}
                    >
                      {c.lastSession ? `Last score ${c.lastSession.scorePct}%` : "Not studied yet"}
                    </Text>
                  </View>
                </View>
              </Pressable>
              </ListItem>
            ))}
            </LayoutAnimationConfig>
          </View>
        )}
      </ScrollView>

      <CollectionFormSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onSaved={(c) => {
          setCreating(false);
          load();
          if (c.id) openCollection(c.id);
        }}
      />
    </SafeAreaView>
  );
}
