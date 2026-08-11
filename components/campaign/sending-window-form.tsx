"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveSendingWindowAction } from "@/actions/settings-actions";
import type { SendingWindow } from "@/services/sending-window-service";

export function SendingWindowForm({ initialValue }: { initialValue: SendingWindow }) {
  const [startHour, setStartHour] = useState(String(initialValue.startHour));
  const [endHour, setEndHour] = useState(String(initialValue.endHour));
  const [timezone, setTimezone] = useState(initialValue.timezone);
  const [sendOnWeekends, setSendOnWeekends] = useState(initialValue.sendOnWeekends);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await saveSendingWindowAction({
      startHour: Number(startHour),
      endHour: Number(endHour),
      timezone,
      sendOnWeekends,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Campaigns pause automatically outside this window and resume once it reopens.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="Start hour (0-23)" value={startHour} onChange={(e) => setStartHour(e.target.value)} />
        <Input
          placeholder="End hour (1-24, 24 = midnight)"
          value={endHour}
          onChange={(e) => setEndHour(e.target.value)}
        />
        <Input
          placeholder="Timezone (e.g. Australia/Brisbane)"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="col-span-2"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={sendOnWeekends}
          onChange={(e) => setSendOnWeekends(e.target.checked)}
        />
        Also send on weekends
      </label>
      <Button size="sm" onClick={handleSave}>
        Save
      </Button>
      {saved && <span className="text-xs text-emerald-400">Saved</span>}
    </div>
  );
}
