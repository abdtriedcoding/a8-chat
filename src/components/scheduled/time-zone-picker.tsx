"use client";

import { getCountry, getTimezone } from "countries-and-timezones";
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
import { currentTimeZoneName } from "../../../convex/lib/timeZone";

type TimeZoneOption = {
  /** The browser's name for the zone, which can be an old one. */
  zone: string;
  /** Its current name, which the list shows and the form saves. */
  name: string;
  /** Such as "(UTC+05:30) Asia/Kolkata". */
  label: string;
  /** Minutes ahead of UTC right now. */
  offset: number;
  /** The countries it covers, such as "India", for search. */
  countries: string[];
};

/**
 * The browser's time zones, plus UTC and `extra`, such as its own zone,
 * which the browser can leave out. A zone it lists under two names shows
 * once. They're sorted by their offset from UTC right now, then by name.
 */
function timeZoneOptions(extra: (string | undefined)[]): TimeZoneOption[] {
  const zones = new Map<string, string>();
  for (const zone of [...Intl.supportedValuesOf("timeZone"), ...extra, "UTC"]) {
    if (zone && !zones.has(currentTimeZoneName(zone))) {
      zones.set(currentTimeZoneName(zone), zone);
    }
  }
  const now = Date.now();
  return [...zones]
    .map(([name, zone]) => {
      const offset = utcOffset(zone, now);
      const label = `(UTC${formatOffset(offset)}) ${name}`;
      const countries = (getTimezone(zone)?.countries ?? []).map(
        (code) => getCountry(code)?.name ?? code,
      );
      return { zone, name, label, offset, countries };
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
 * How well the search matches the zone, 0 being best, or null for no
 * match. Each word of the search ranks by where it's found in the zone's
 * name, old name or countries: 0 as a whole word, 1 at a word's start, 2
 * inside a word. A word found only in its offset label ranks 3. The zone
 * ranks as its worst word. Every label has "UTC" in it, so "utc" ranks
 * the UTC zone first, and "india" ranks Kolkata above America/Indiana.
 * Names match without their underscores and offsets without their leading
 * zero, so "new york", "utc+5" and "calcutta" all find a zone.
 */
function matchRank(option: TimeZoneOption, search: string): number | null {
  const place = [
    option.name.replace(/_/g, " "),
    option.zone.replace(/_/g, " "),
    ...option.countries,
  ]
    .join(" ")
    .toLowerCase();
  const placeWords = place.split(/[\s/]+/);
  const offset = [
    option.label,
    `utc${formatOffset(option.offset).replace(/^([+-])0/, "$1")}`,
  ]
    .join(" ")
    .toLowerCase();
  let rank = 0;
  for (const word of search.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (placeWords.includes(word)) continue;
    if (placeWords.some((placeWord) => placeWord.startsWith(word))) {
      rank = Math.max(rank, 1);
    } else if (place.includes(word)) {
      rank = Math.max(rank, 2);
    } else if (offset.includes(word)) {
      rank = 3;
    } else {
      return null;
    }
  }
  return rank;
}

/**
 * The zones that match the search, best matches first, each with its rank
 * (matchRank).
 */
function searchOptions(
  options: TimeZoneOption[],
  search: string,
): { option: TimeZoneOption; rank: number }[] {
  return options
    .map((option) => ({ option, rank: matchRank(option, search) }))
    .filter((match): match is { option: TimeZoneOption; rank: number } =>
      match.rank !== null,
    )
    .sort((a, b) => a.rank - b.rank);
}

/**
 * The list's groups for the search. The browser's own zone, `own`, gets a
 * group of its own at the top, but while searching only when it matches
 * as well as the best match, so a weaker match doesn't go above it.
 */
function listGroups(options: TimeZoneOption[], search: string, own: string) {
  const matches = search.trim()
    ? searchOptions(options, search)
    : options.map((option) => ({ option, rank: 0 }));
  const ownMatch = matches.find(({ option }) => option.name === own);
  const ownFirst = ownMatch !== undefined && ownMatch.rank === matches[0].rank;
  return [
    {
      heading: "Your time zone",
      options: ownFirst ? [ownMatch.option] : [],
    },
    {
      heading: "All time zones",
      options: matches
        .filter((match) => !ownFirst || match !== ownMatch)
        .map(({ option }) => option),
    },
  ].filter((group) => group.options.length > 0);
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
  const picked = currentTimeZoneName(value);
  const own = currentTimeZoneName(ownTimeZone);
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

  // A search highlights its best match, which the list scrolls to. Left
  // on the picked zone, the list would stay scrolled to it.
  function changeSearch(next: string) {
    setSearch(next);
    setHighlighted(
      next.trim()
        ? (listGroups(options, next, own)[0]?.options[0]?.name ?? "")
        : picked,
    );
  }

  const groups = listGroups(options, search, own);
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
            onValueChange={changeSearch}
            placeholder="Search time zones…"
          />
          <CommandList>
            <CommandEmpty>No time zones match.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.options.map((option) => (
                  <CommandItem
                    key={option.name}
                    // Not while searching, when the picked zone can move
                    // groups and mount again below the best match.
                    ref={
                      option.name === picked && !search.trim()
                        ? scrollIntoViewOnMount
                        : undefined
                    }
                    value={option.name}
                    data-checked={option.name === picked}
                    onSelect={() => pick(option.name)}
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
