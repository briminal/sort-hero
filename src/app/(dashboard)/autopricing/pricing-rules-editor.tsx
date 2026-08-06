"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { saveRules, applyAutopricing } from "./actions";
import type { PricingRule, RuleType } from "@/types/pricing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const RULE_LABELS: Record<RuleType, string> = {
  condition_multiplier: "Condition multiplier",
  margin_percent: "Margin %",
  margin_fixed: "Margin (fixed cents)",
  round_to_nearest: "Round to nearest",
  min_price: "Minimum price",
  max_price: "Maximum price",
};

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

function defaultConfigFor(ruleType: RuleType): Record<string, unknown> {
  switch (ruleType) {
    case "condition_multiplier":
      return { NM: 100, LP: 85, MP: 70, HP: 50, DMG: 30 };
    case "margin_percent":
      return { percent: 0 };
    case "round_to_nearest":
      return { cents: 25 };
    case "margin_fixed":
    case "min_price":
    case "max_price":
      return { cents: 0 };
  }
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" ? value : fallback;
}

function SortableRule({
  rule,
  onChange,
  onRemove,
}: {
  rule: PricingRule;
  onChange: (next: PricingRule) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id!,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} data-testid="pricing-rule" data-rule-type={rule.ruleType} className="list-none">
      <Card className={cn("flex flex-wrap items-center gap-3 p-3", isDragging && "opacity-60")}>
        <span
          {...attributes}
          {...listeners}
          role="button"
          aria-label={`Drag to reorder ${RULE_LABELS[rule.ruleType]}`}
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>

        <Badge variant={rule.enabled ? "default" : "secondary"} className="shrink-0">
          {RULE_LABELS[rule.ruleType]}
        </Badge>

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
            className="size-4 rounded border-input accent-primary"
          />
          Enabled
        </label>

        {rule.ruleType === "condition_multiplier" && (
          <div className="flex flex-wrap items-center gap-3">
            {CONDITIONS.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{c}</span>
                <Input
                  type="number"
                  value={num(rule.config, c, 100)}
                  onChange={(e) => onChange({ ...rule, config: { ...rule.config, [c]: Number(e.target.value) } })}
                  aria-label={`${c} percent`}
                  className="h-8 w-16"
                />
              </label>
            ))}
          </div>
        )}

        {rule.ruleType === "margin_percent" && (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Percent</span>
            <Input
              type="number"
              value={num(rule.config, "percent", 0)}
              onChange={(e) => onChange({ ...rule, config: { percent: Number(e.target.value) } })}
              aria-label="Margin percent value"
              className="h-8 w-20"
            />
          </label>
        )}

        {(rule.ruleType === "margin_fixed" ||
          rule.ruleType === "round_to_nearest" ||
          rule.ruleType === "min_price" ||
          rule.ruleType === "max_price") && (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Cents</span>
            <Input
              type="number"
              value={num(rule.config, "cents", 0)}
              onChange={(e) => onChange({ ...rule, config: { cents: Number(e.target.value) } })}
              aria-label={`${RULE_LABELS[rule.ruleType]} value`}
              className="h-8 w-20"
            />
          </label>
        )}

        <Button variant="ghost" size="icon" className="ml-auto" onClick={onRemove} aria-label={`Remove ${RULE_LABELS[rule.ruleType]}`}>
          <Trash2 className="size-4" />
        </Button>
      </Card>
    </li>
  );
}

export function PricingRulesEditor({ initialRules }: { initialRules: PricingRule[] }) {
  const [rules, setRules] = useState<PricingRule[]>(initialRules);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setRules((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id);
      const newIndex = prev.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex).map((r, i) => ({ ...r, stepOrder: i }));
    });
  }

  function updateRule(id: string, next: PricingRule) {
    setRules((prev) => prev.map((r) => (r.id === id ? next : r)));
  }

  function removeRule(id: string) {
    setRules((prev) =>
      prev.filter((r) => r.id !== id).map((r, i) => ({ ...r, stepOrder: i })),
    );
  }

  function addRule(ruleType: RuleType) {
    setRules((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        stepOrder: prev.length,
        ruleType,
        config: defaultConfigFor(ruleType),
        enabled: true,
      },
    ]);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    const result = await saveRules({ rules });
    setSaving(false);
    setSaveMessage("error" in result ? `Error: ${result.error}` : "Saved.");
  }

  async function handleApply() {
    setApplying(true);
    setApplyMessage(null);
    const result = await applyAutopricing();
    setApplying(false);
    setApplyMessage(
      "error" in result
        ? `Error: ${result.error}`
        : `Priced ${result.priced} item(s), skipped ${result.skipped} (no market price data).`,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RULE_LABELS) as RuleType[]).map((rt) => (
          <Button key={rt} variant="outline" size="sm" onClick={() => addRule(rt)} className="gap-1">
            <Plus className="size-3.5" />
            {RULE_LABELS[rt]}
          </Button>
        ))}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rules.map((r) => r.id!)} strategy={verticalListSortingStrategy}>
          <ul data-testid="rules-list" className="space-y-2">
            {rules.map((rule) => (
              <SortableRule
                key={rule.id}
                rule={rule}
                onChange={(next) => updateRule(rule.id!, next)}
                onRemove={() => removeRule(rule.id!)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save rules"}
        </Button>
        {saveMessage && (
          <span data-testid="save-message" className="text-sm text-muted-foreground">
            {saveMessage}
          </span>
        )}

        <Button variant="secondary" onClick={handleApply} disabled={applying}>
          {applying ? "Applying..." : "Run Autopricing"}
        </Button>
        {applyMessage && (
          <span data-testid="apply-message" className="text-sm text-muted-foreground">
            {applyMessage}
          </span>
        )}
      </div>
    </div>
  );
}
