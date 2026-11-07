import { DEFAULT_FREQUENCY_TIERS, MAX_FREQUENCY_TIERS } from "@shared/frequency";
import { Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/utils";

export type FrequencyMode = "every" | "milestone" | "dynamic";

/** Tier values are kept as strings while editing so inputs can be cleared. */
export interface TierDraft {
  from: string;
  every: string;
}

export const defaultTierDrafts = (): TierDraft[] =>
  DEFAULT_FREQUENCY_TIERS.map((t) => ({ from: String(t.from), every: String(t.every) }));

const HELP: Record<FrequencyMode, string> = {
  every: "Notify on every new star.",
  milestone: "Notify only when the star count hits a multiple, for example every 10 or 100 stars.",
  dynamic: "Notify less often as a repository grows. A tier applies from its star count until the next tier.",
};

function everyLabel(every: string) {
  const n = Number(every);
  if (!every || !Number.isFinite(n)) return "";
  return n === 1 ? "Every new star" : `Every ${formatNumber(n)} new stars`;
}

function rangeLabel(tiers: TierDraft[], index: number) {
  const from = Number(tiers[index].from) || 0;
  const next = tiers[index + 1] ? Number(tiers[index + 1].from) : null;
  if (next === null || !Number.isFinite(next) || next <= from) return `${formatNumber(from)}+`;
  return `${formatNumber(from)} to ${formatNumber(next - 1)}`;
}

export function FrequencySettings({
  mode,
  milestoneEvery,
  tiers,
  onModeChange,
  onMilestoneChange,
  onTiersChange,
}: {
  mode: FrequencyMode;
  milestoneEvery: string;
  tiers: TierDraft[];
  onModeChange: (mode: FrequencyMode) => void;
  onMilestoneChange: (value: string) => void;
  onTiersChange: (tiers: TierDraft[]) => void;
}) {
  const update = (index: number, key: keyof TierDraft, value: string) =>
    onTiersChange(tiers.map((t, i) => (i === index ? { ...t, [key]: value } : t)));

  function addTier() {
    const last = tiers[tiers.length - 1];
    const from = (Number(last?.from) || 0) + 100;
    const every = (Number(last?.every) || 1) * 2;
    onTiersChange([...tiers, { from: String(from), every: String(every) }]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr] sm:items-center">
        <Label htmlFor="frequency-mode">Frequency</Label>
        <Select value={mode} onValueChange={(v) => onModeChange(v as FrequencyMode)}>
          <SelectTrigger id="frequency-mode" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="every">Every star</SelectItem>
            <SelectItem value="milestone">Milestones</SelectItem>
            <SelectItem value="dynamic">Dynamic</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">{HELP[mode]}</p>

      {mode === "milestone" && (
        <div className="grid gap-2 sm:w-56">
          <Label htmlFor="milestone">Every N stars</Label>
          <Input
            id="milestone"
            type="number"
            min={2}
            required
            placeholder="100"
            value={milestoneEvery}
            onChange={(e) => onMilestoneChange(e.target.value)}
          />
        </div>
      )}

      {mode === "dynamic" && (
        <div className="rounded-md border">
          <div
            className={
              "grid grid-cols-[1fr_1fr_2rem] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground"
            }
          >
            <span>From stars</span>
            <span>Notify on</span>
            <span />
          </div>
          <ul className="divide-y">
            {tiers.map((tier, i) => (
              <li key={i} className="grid grid-cols-[1fr_1fr_2rem] items-start gap-2 px-3 py-2">
                <div className="grid gap-1">
                  <Input
                    type="number"
                    min={0}
                    required
                    aria-label="From stars"
                    value={tier.from}
                    disabled={i === 0}
                    onChange={(e) => update(i, "from", e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">{rangeLabel(tiers, i)} stars</span>
                </div>
                <div className="grid gap-1">
                  <Input
                    type="number"
                    min={1}
                    required
                    aria-label="Notify every N stars"
                    value={tier.every}
                    onChange={(e) => update(i, "every", e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">{everyLabel(tier.every)}</span>
                </div>
                {i > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove tier"
                    onClick={() => onTiersChange(tiers.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addTier}
              disabled={tiers.length >= MAX_FREQUENCY_TIERS}
            >
              <Plus />
              Add tier
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onTiersChange(defaultTierDrafts())}>
              <RotateCcw />
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
