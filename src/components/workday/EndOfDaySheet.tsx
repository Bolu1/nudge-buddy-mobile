import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { EndOfDayData } from "@/lib/workday";
import { useOpenKey } from "@/lib/use-open-key";
import { haptic } from "@/lib/haptics";
import { Celebration } from "@/components/Celebration";
import { Button, Checkbox, Sheet } from "@/components/ui";

type EndOfDayProps = {
  data: EndOfDayData | null;
  onAddToTasks: (goals: { id: string; title: string }[]) => Promise<void>;
  onDismiss: () => void;
};

/** Summary after a workday ends — carry unfinished goals over as tasks */
export function EndOfDaySheet(props: EndOfDayProps) {
  const openKey = useOpenKey(!!props.data);
  if (!props.data) return null;
  return <EndOfDayForm key={openKey} {...props} data={props.data} />;
}

function EndOfDayForm({ data, onAddToTasks, onDismiss }: EndOfDayProps & { data: EndOfDayData }) {
  // Every unfinished goal starts ticked
  const [selected, setSelected] = useState<Set<string>>(() => new Set(data.unachievedGoals.map((g) => g.id)));
  const [adding, setAdding] = useState(false);

  const allDone = data.unachievedGoals.length === 0;

  useEffect(() => {
    haptic.success();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <Sheet
      visible
      onClose={onDismiss}
      title="Workday complete!"
      footer={
        allDone ? (
          <Button title="Done" onPress={onDismiss} />
        ) : (
          <View className="flex-row justify-end gap-2">
            <Button title="Skip" variant="ghost" onPress={onDismiss} />
            <Button
              title={adding ? "Adding…" : `Add ${selected.size} to tasks`}
              loading={adding}
              disabled={selected.size === 0}
              onPress={async () => {
                setAdding(true);
                await onAddToTasks(data.unachievedGoals.filter((g) => selected.has(g.id)));
              }}
            />
          </View>
        )
      }
    >
      <Celebration title={allDone ? "Every goal done!" : "That's a wrap"} />
      <Text className="text-outline text-sm text-center">
        {data.completedGoals}/{data.totalGoals} goals completed
      </Text>
      {allDone ? (
        <Text className="text-primary text-sm">All goals completed — great work!</Text>
      ) : (
        <View className="gap-2">
          <Text className="text-on-surface-variant text-sm">Carry these over to your tasks?</Text>
          {data.unachievedGoals.map((g) => (
            <Pressable key={g.id} onPress={() => toggle(g.id)} className="flex-row items-center gap-3 py-1.5">
              <Checkbox checked={selected.has(g.id)} size={18} onPress={() => toggle(g.id)} />
              <Text className="text-on-surface-variant text-sm flex-1">{g.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}
