import type { TimeFormat, TimePreferences, TimeStyle } from "@shared/time";
import { useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveTimePreferences, useTimePreferences } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

/** Select value for "no timezone chosen". Radix Select does not allow an empty value. */
const DEFAULT_ZONE = "default";

const TIME_FORMAT_LABELS: Record<TimeFormat, string> = {
  auto: "Automatic",
  "12h": "12-hour (7:00 PM)",
  "24h": "24-hour (19:00)",
};

const TIME_STYLE_LABELS: Record<TimeStyle, string> = {
  relative: "Relative (5 minutes ago)",
  absolute: "Date and time",
};

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function timeZones(current: string | null) {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  if (current) zones.add(current);
  return [...zones].sort();
}

export function TimeSettings() {
  const { data } = useTimePreferences();
  const save = useSaveTimePreferences();
  const zones = useMemo(() => timeZones(data?.timezone ?? null), [data?.timezone]);
  if (!data) return null;

  function update(patch: Partial<TimePreferences>) {
    save.mutate(patch, {
      onSuccess: () => toast.success("Time display saved"),
      onError: (err) => toast.error(errorMessage(err)),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time display</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="time-zone">Timezone</Label>
          <Select
            value={data.timezone ?? DEFAULT_ZONE}
            disabled={save.isPending}
            onValueChange={(v) => update({ timezone: v === DEFAULT_ZONE ? null : v })}
          >
            <SelectTrigger id="time-zone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_ZONE}>Default</SelectItem>
              {zones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data.timezone === null && (
            <p className="text-xs text-muted-foreground">
              The app uses your browser ({browserTimeZone()}). Notifications use the server ({data.serverTimezone}).
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="time-format">Clock</Label>
            <Select
              value={data.timeFormat}
              disabled={save.isPending}
              onValueChange={(v) => update({ timeFormat: v as TimeFormat })}
            >
              <SelectTrigger id="time-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIME_FORMAT_LABELS) as TimeFormat[]).map((format) => (
                  <SelectItem key={format} value={format}>
                    {TIME_FORMAT_LABELS[format]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="time-style">Recent times</Label>
            <Select
              value={data.timeStyle}
              disabled={save.isPending}
              onValueChange={(v) => update({ timeStyle: v as TimeStyle })}
            >
              <SelectTrigger id="time-style" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIME_STYLE_LABELS) as TimeStyle[]).map((style) => (
                  <SelectItem key={style} value={style}>
                    {TIME_STYLE_LABELS[style]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Now: {formatDateTime(new Date())}</p>
      </CardContent>
    </Card>
  );
}
