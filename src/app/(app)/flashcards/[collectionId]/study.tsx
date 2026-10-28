import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { SafeAreaView } from "@/components/ui/SafeArea";
import { router, useLocalSearchParams } from "expo-router";
import { flashcards as flashcardsApi } from "@/lib/api";
import { apiError, unwrap } from "@/lib/boards";
import type { CollectionDetail } from "@/lib/flashcards";
import { StudySession } from "@/components/flashcards/StudySession";
import { Button, Spinner } from "@/components/ui";

export default function StudyScreen() {
  const params = useLocalSearchParams<{ collectionId: string; mode?: string; shuffle?: string }>();
  const collectionId = params.collectionId;
  const shuffled = params.shuffle !== "0";

  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await flashcardsApi.get(collectionId);
      if (cancelled) return;
      const detail = res.ok ? unwrap<CollectionDetail>(res) : null;
      if (!detail) { setLoadError(apiError(res, "Couldn't load this collection.")); return; }
      setCollection(detail);
    })();
    return () => { cancelled = true; };
  }, [collectionId]);

  const leave = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/flashcards")), []);

  if (loadError) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center gap-3 p-8">
        <Text className="text-on-surface-variant text-sm text-center">{loadError}</Text>
        <Button title="Back" variant="tonal" onPress={leave} />
      </SafeAreaView>
    );
  }

  if (!collection) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <Spinner className="flex-1" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-bg">
      <StudySession
        collection={collection}
        initialMode={params.mode === "MISSED" ? "MISSED" : "ALL"}
        shuffled={shuffled}
        onLeave={leave}
      />
    </SafeAreaView>
  );
}
