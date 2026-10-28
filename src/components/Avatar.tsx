import { useState } from "react";
import { Text, View } from "react-native";
import { SvgUri } from "react-native-svg";

const DICEBEAR_URL = "https://api.dicebear.com/10.x/landscape/svg";

/**
 * DiceBear picture seeded by the user's id (same as the web app — stable per
 * person, never sends their name or email). Falls back to initials.
 */
export function Avatar({
  id,
  firstName,
  lastName,
  size = 32,
  ring,
}: {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  size?: number;
  /** Border colour that separates overlapping avatars */
  ring?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letters = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    overflow: "hidden" as const,
    ...(ring ? { borderWidth: 2, borderColor: ring } : {}),
  };

  if (!id || failed) {
    return (
      <View style={frame} className="bg-surface-high items-center justify-center">
        <Text className="text-on-surface-variant font-semibold" style={{ fontSize: Math.max(9, Math.round(size * 0.36)) }}>
          {letters}
        </Text>
      </View>
    );
  }
  return (
    <View style={frame} className="bg-surface-high">
      <SvgUri uri={`${DICEBEAR_URL}?seed=${encodeURIComponent(id)}`} width={size} height={size} onError={() => setFailed(true)} />
    </View>
  );
}
