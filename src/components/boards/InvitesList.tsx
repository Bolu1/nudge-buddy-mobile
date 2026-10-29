import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { boards as boardsApi } from "@/lib/api";
import { ROLE_LABEL, apiError, fullName, unwrap, type MyInvite } from "@/lib/boards";
import { emitChange, onChange } from "@/lib/events";
import { Button, SectionTitle } from "@/components/ui";

/** The signed-in user's pending board invites, with accept / decline. */
export function InvitesList({ onAccepted, showEmpty = false }: { onAccepted?: (boardId: string) => void; showEmpty?: boolean }) {
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await boardsApi.myInvites();
    if (res.ok) setInvites(unwrap<MyInvite[]>(res) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    return onChange("invites", load);
  }, [load]);

  async function respond(invite: MyInvite, accept: boolean) {
    setBusyId(invite.id);
    setError("");
    const res = accept ? await boardsApi.acceptInvite(invite.id) : await boardsApi.declineInvite(invite.id);
    setBusyId(null);
    if (!res.ok) { setError(apiError(res)); load(); return; }
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    emitChange("invites");
    emitChange("boards");
    if (accept) onAccepted?.(invite.board.id);
  }

  if (loading) return showEmpty ? <View className="h-20 rounded-xl bg-surface-low border border-divider" /> : null;
  if (!invites.length && !showEmpty) return null;

  return (
    <View>
      <SectionTitle>Invites{invites.length ? ` · ${invites.length}` : ""}</SectionTitle>
      {error ? <Text className="text-secondary text-xs mb-2">{error}</Text> : null}
      {!invites.length ? (
        <View className="rounded-2xl bg-surface-low border border-divider p-6 items-center">
          <Text className="text-outline text-sm">No pending invites.</Text>
        </View>
      ) : (
        <View className="gap-2">
          {invites.map((inv) => (
            <View key={inv.id} className="bg-[#1a2b1a] border border-on-primary-container rounded-xl p-4 gap-3">
              <View className="flex-row items-center gap-3">
                <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: inv.board.color ?? "#8da38a" }} />
                <View className="flex-1">
                  <Text className="text-on-surface text-sm font-medium" numberOfLines={1}>{inv.board.name}</Text>
                  <Text className="text-outline text-xs" numberOfLines={1}>
                    {fullName(inv.invitedBy)} invited you as {ROLE_LABEL[inv.role].toLowerCase()}
                  </Text>
                </View>
              </View>
              <View className="flex-row justify-end gap-2">
                <Button title="Decline" variant="ghost" size="sm" onPress={() => respond(inv, false)} disabled={busyId === inv.id} />
                <Button title={busyId === inv.id ? "…" : "Accept"} size="sm" onPress={() => respond(inv, true)} disabled={busyId === inv.id} />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
