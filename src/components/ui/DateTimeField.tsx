import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { colors } from "@/lib/theme";
import { Icon } from "./Icon";
import { Button, Sheet } from "./index";

type Mode = "datetime" | "date" | "time";

function format(d: Date, mode: Mode): string {
  if (mode === "time") return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (mode === "date") return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Replaces the web's <input type="datetime-local">. iOS: inline picker in a
 * sheet. Android: the system date dialog, then the time dialog.
 */
export function DateTimeField({
  value,
  onChange,
  mode = "datetime",
  placeholder = "Pick a time",
  clearable = true,
  minimumDate,
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  mode?: Mode;
  placeholder?: string;
  clearable?: boolean;
  minimumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? defaultDate());

  function openPicker() {
    const start = value ?? defaultDate();
    if (Platform.OS === "android") {
      const pickTime = (base: Date) =>
        DateTimePickerAndroid.open({
          value: base,
          mode: "time",
          onValueChange: (_e, t) => {
            const d = new Date(base);
            d.setHours(t.getHours(), t.getMinutes(), 0, 0);
            onChange(d);
          },
        });
      if (mode === "time") return pickTime(start);
      DateTimePickerAndroid.open({
        value: start,
        mode: "date",
        minimumDate,
        onValueChange: (_e, d) => {
          const merged = new Date(d);
          merged.setHours(start.getHours(), start.getMinutes(), 0, 0);
          if (mode === "date") onChange(merged);
          else pickTime(merged);
        },
      });
      return;
    }
    setDraft(start);
    setOpen(true);
  }

  return (
    <>
      <View className="flex-row items-center w-full bg-field border border-field-border rounded-xl">
        <Pressable onPress={openPicker} className="flex-1 flex-row items-center gap-2 px-4 py-3">
          <Icon name={mode === "time" ? "clock" : "calendar"} size={15} color={colors.outline} />
          <Text className={`text-sm ${value ? "text-on-surface" : "text-placeholder"}`}>
            {value ? format(value, mode) : placeholder}
          </Text>
        </Pressable>
        {clearable && value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={8} className="px-3 py-3">
            <Icon name="x" size={15} color={colors.outline} />
          </Pressable>
        ) : null}
      </View>
      {Platform.OS === "ios" ? (
        <Sheet
          visible={open}
          onClose={() => setOpen(false)}
          title={placeholder}
          footer={
            <Button
              title="Done"
              onPress={() => {
                onChange(draft);
                setOpen(false);
              }}
            />
          }
        >
          <View className="items-center">
            <DateTimePicker
              value={draft}
              mode={mode}
              display={mode === "time" ? "spinner" : "inline"}
              themeVariant="dark"
              accentColor={colors.primaryContainer}
              minimumDate={minimumDate}
              onValueChange={(_e, d) => setDraft(d)}
            />
          </View>
        </Sheet>
      ) : null}
    </>
  );
}

function defaultDate() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
