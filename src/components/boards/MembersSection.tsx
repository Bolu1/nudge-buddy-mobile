import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { boards as boardsApi } from "@/lib/api";
import { ROLE_HINT, ROLE_LABEL, apiError, fullName, unwrap, type BoardDetail, type BoardRole } from "@/lib/boards";
import { colors } from "@/lib/theme";
import { Avatar } from "@/components/Avatar";
import { Button, Field, Icon, SectionTitle, Segmented } from "@/components/ui";

type InviteResult = { email: string; result: "invited" | "resent" | "already_member" | "self" };

const RESULT_LABEL: Record<InviteResult["result"], string> = {
  invited: "Invited",
  resent: "Invite resent",
  already_member: "Already a member",
  self: "That's you",
};

function confirm(title: string, message: string, action: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: "destructive", onPress: onConfirm },
  ]);
}

/** Member list, owner controls, invites, and leave/delete for one board. */
export function MembersSection({ board, onChanged, onGone }: { board: BoardDetail; onChanged: () => void; onGone: () => void }) {
  const isOwner = board.role === "OWNER";
  const [emails, setEmails] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<BoardRole, "OWNER">>("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [results, setResults] = useState<InviteResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ ok: boolean; data: unknown }>, after?: () => void) {
    setBusy(key);
    setError("");
    const res = await action();
    setBusy(null);
    if (!res.ok) { setError(apiError(res)); return; }
    (after ?? onChanged)();
  }

  async function invite() {
    const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return;
    const invalid = list.filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (invalid.length) { setError(`Not a valid email: ${invalid.join(", ")}`); return; }
    setInviting(true);
    setError("");
    setResults([]);
    const res = await boardsApi.invite(board.id, { emails: list, role: inviteRole });
    setInviting(false);
    if (!res.ok) { setError(apiError(res)); return; }
    setResults(unwrap<{ results: InviteResult[] }>(res)?.results ?? []);
    setEmails("");
    onChanged();
  }

  return (
    <View className="gap-4">
      <View className="bg-surface-low border border-divider rounded-2xl p-4">
        <SectionTitle>Members · {board.members.length}</SectionTitle>
        <View className="gap-3">
          {board.members.map((m) => {
            const isMe = m.id === board.viewerId;
            const manageable = isOwner && !isMe && m.role !== "OWNER";
            return (
              <View key={m.id} className="flex-row items-center gap-3">
                <Avatar id={m.id} firstName={m.firstName} lastName={m.lastName} size={32} />
                <View className="flex-1">
                  <Text className="text-on-surface-variant text-sm" numberOfLines={1}>
                    {fullName(m)}{isMe ? <Text className="text-outline"> (you)</Text> : null}
                  </Text>
                  {manageable ? (
                    <Pressable
                      disabled={!!busy}
                      onPress={() => {
                        const next = m.role === "EDITOR" ? "MEMBER" : "EDITOR";
                        run(`role-${m.id}`, () => boardsApi.setMemberRole(board.id, m.id, next));
                      }}
                      className="flex-row items-center gap-1 mt-0.5"
                    >
                      <Text className="text-outline text-xs">{ROLE_LABEL[m.role]}</Text>
                      <Icon name="refresh" size={10} color={colors.outline} />
                    </Pressable>
                  ) : (
                    <Text className="text-outline text-xs">{ROLE_LABEL[m.role]}</Text>
                  )}
                </View>
                {isOwner && !isMe ? (
                  <View className="flex-row items-center gap-1">
                    <Pressable
                      disabled={!!busy}
                      accessibilityLabel={`Make ${fullName(m)} the owner`}
                      onPress={() => confirm("Transfer ownership?", `Make ${fullName(m)} the owner? You'll become an editor.`, "Make owner",
                        () => run(`owner-${m.id}`, () => boardsApi.transferOwnership(board.id, m.id)))}
                      className="p-2 rounded-lg"
                    >
                      <Icon name="flag" size={15} color={colors.outline} />
                    </Pressable>
                    <Pressable
                      disabled={!!busy}
                      accessibilityLabel={`Remove ${fullName(m)}`}
                      onPress={() => confirm("Remove member?", `Remove ${fullName(m)} from ${board.name}?`, "Remove",
                        () => run(`remove-${m.id}`, () => boardsApi.removeMember(board.id, m.id)))}
                      className="p-2 rounded-lg"
                    >
                      <Icon name="x" size={15} color={colors.outline} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        {isOwner ? <Text className="text-outline text-[11px] mt-3">Tap a role to switch editor/member.</Text> : null}
      </View>

      {isOwner ? (
        <View className="bg-surface-low border border-divider rounded-2xl p-4 gap-3">
          <SectionTitle>Invite people</SectionTitle>
          <Field
            value={emails}
            onChangeText={setEmails}
            placeholder="Emails, separated by commas"
            autoCapitalize="none"
            keyboardType="email-address"
            multiline
          />
          <View className="flex-row items-center justify-between gap-2">
            <Segmented
              value={inviteRole}
              onChange={setInviteRole}
              options={[{ value: "MEMBER", label: "As member" }, { value: "EDITOR", label: "As editor" }]}
            />
            <Button title={inviting ? "Sending…" : "Invite"} variant="tonal" size="sm" onPress={invite} loading={inviting} disabled={!emails.trim()} />
          </View>
          <Text className="text-outline text-xs">{ROLE_HINT[inviteRole]}. People without an account get a sign-up link.</Text>
          {results.map((r) => (
            <View key={r.email} className="flex-row justify-between gap-2">
              <Text className="text-outline text-xs flex-1" numberOfLines={1}>{r.email}</Text>
              <Text className={`text-xs ${r.result === "invited" || r.result === "resent" ? "text-primary" : "text-outline"}`}>{RESULT_LABEL[r.result]}</Text>
            </View>
          ))}
          {board.invites.length ? (
            <View className="pt-3 border-t border-divider gap-2">
              <Text className="text-outline text-xs">Pending</Text>
              {board.invites.map((inv) => (
                <View key={inv.id} className="flex-row items-center gap-2">
                  <Text className="flex-1 text-on-surface-variant text-xs" numberOfLines={1}>{inv.email}</Text>
                  <Text className="text-outline text-xs">{ROLE_LABEL[inv.role]}</Text>
                  <Pressable disabled={!!busy} onPress={() => run(`revoke-${inv.id}`, () => boardsApi.revokeInvite(board.id, inv.id))} hitSlop={8}>
                    <Text className="text-outline text-xs">Revoke</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Text className="text-secondary text-xs bg-secondary-container/30 border border-secondary-container rounded-lg px-3 py-2">{error}</Text> : null}

      <View className="px-1">
        {isOwner ? (
          <Pressable
            disabled={!!busy}
            onPress={() => confirm("Delete board?", `Delete "${board.name}" and all its tasks for everyone? This can't be undone.`, "Delete",
              () => run("delete", () => boardsApi.delete(board.id), onGone))}
          >
            <Text className="text-outline text-xs">Delete board</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!!busy}
            onPress={() => confirm("Leave board?", `Leave "${board.name}"? You'll be unassigned from its tasks.`, "Leave",
              () => run("leave", () => boardsApi.leave(board.id), onGone))}
          >
            <Text className="text-outline text-xs">Leave board</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
