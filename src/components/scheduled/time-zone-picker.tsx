"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The zones Chrome still lists under an old IANA name, such as
 * Asia/Calcutta, mapped to the name they have now.
 */
const CURRENT_NAMES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** `zone`'s current IANA name, which can differ from the browser's. */
function currentName(zone: string): string {
  return CURRENT_NAMES[zone] ?? zone;
}

type TimeZoneOption = {
  /** The browser's name for the zone, which the form saves. */
  zone: string;
  /** Its current name, which the list shows. */
  name: string;
  /** Such as "(UTC+05:30) Asia/Kolkata". */
  label: string;
  /** Minutes ahead of UTC right now. */
  offset: number;
};

/**
 * The browser's time zones, plus UTC and `extra`, such as its own zone,
 * which the browser can leave out. A zone it lists under two names shows
 * once. They're sorted by their offset from UTC right now, then by name.
 */
function timeZoneOptions(extra: (string | undefined)[]): TimeZoneOption[] {
  const zones = new Map<string, string>();
  for (const zone of [...Intl.supportedValuesOf("timeZone"), ...extra, "UTC"]) {
    if (zone && !zones.has(currentName(zone))) {
      zones.set(currentName(zone), zone);
    }
  }
  const now = Date.now();
  return [...zones]
    .map(([name, zone]) => {
      const offset = utcOffset(zone, now);
      const label = `(UTC${formatOffset(offset)}) ${name}`;
      return { zone, name, label, offset };
    })
    .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name));
}

/** How many minutes `zone` is ahead of UTC at `time`. */
function utcOffset(zone: string, time: number): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  })
    .formatToParts(time)
    .find((part) => part.type === "timeZoneName")?.value;
  // "GMT+05:30", or just "GMT" at UTC.
  const match = name?.match(/^GMT([+\-−])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? minutes : -minutes;
}

/** Such as "+05:30" or "-03:00". */
function formatOffset(offset: number): string {
  const sign = offset < 0 ? "-" : "+";
  const minutes = Math.abs(offset);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Whether every word of the search is in the zone's label. The label also
 * matches without its spaces' underscores, without its offset's leading
 * zero, or by the zone's old name, so "new york", "utc+5" and "calcutta"
 * all find a zone.
 */
function matches(option: TimeZoneOption, search: string): boolean {
  const haystack = [
    option.label,
    option.name.replace(/_/g, " "),
    option.zone.replace(/_/g, " "),
    `utc${formatOffset(option.offset).replace(/^([+-])0/, "$1")}`,
  ]
    .join(" ")
    .toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** Keeps the picked zone in view when the list opens on it. */
function scrollIntoViewOnMount(node: HTMLElement | null) {
  node?.scrollIntoView({ block: "nearest" });
}

/**
 * A button that opens a searchable list of time zones, labelled with their
 * offset from UTC. The browser's own zone, `ownTimeZone`, comes first.
 */
export function TimeZonePicker({
  id,
  value,
  onChange,
  ownTimeZone,
  disabled = false,
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  ownTimeZone: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [options] = useState(() => timeZoneOptions([ownTimeZone, value]));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // The list goes by current names, since the form's zone and the
  // browser's can be under an old one.
  const picked = currentName(value);
  const own = currentName(ownTimeZone);
  const [highlighted, setHighlighted] = useState(picked);

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    // Each open starts with the picked zone highlighted.
    setSearch("");
    setHighlighted(picked);
  }

  function pick(zone: string) {
    onChange(zone);
    setOpen(false);
  }

  const shown = search.trim()
    ? options.filter((option) => matches(option, search))
    : options;
  const groups = [
    {
      heading: "Your time zone",
      options: shown.filter((option) => option.name === own),
    },
    {
      heading: "All time zones",
      options: shown.filter((option) => option.name !== own),
    },
  ].filter((group) => group.options.length > 0);
  const label = options.find((option) => option.name === picked)?.label;

  return (
    // Modal, so the sheet around it lets the list scroll.
    <Popover open={open} onOpenChange={openChange} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-invalid={invalid}
          disabled={disabled}
          className="w-full justify-between px-2.5 font-normal"
        >
          <span className="truncate">{label ?? value}</span>
          <ChevronDownIcon
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        aria-label="Choose a time zone"
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <Command
          // cmdk names its search box after this label.
          label="Search time zones"
          shouldFilter={false}
          value={highlighted}
          onValueChange={setHighlighted}
        >
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search time zones…"
          />
          <CommandList>
            <CommandEmpty>No time zones match.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.options.map((option) => (
                  <CommandItem
                    key={option.name}
                    ref={
                      option.name === picked ? scrollIntoViewOnMount : undefined
                    }
                    value={option.name}
                    data-checked={option.name === picked}
                    onSelect={() => pick(option.zone)}
                  >
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
