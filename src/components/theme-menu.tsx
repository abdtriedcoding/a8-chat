"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

function ThemeRadioGroup() {
  // Menus render only once opened, so the stored theme is known by then.
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
      {THEMES.map(({ value, label, icon: Icon }) => (
        <DropdownMenuRadioItem key={value} value={value}>
          <Icon />
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** A submenu that picks light, dark, or the system's theme. */
export function ThemeSubmenu() {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <SunIcon className="dark:hidden" />
        <MoonIcon className="hidden dark:block" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="min-w-36">
          <ThemeRadioGroup />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/**
 * The theme options inline, under a label. On a phone the menu fills the
 * sidebar sheet, which leaves too little room on either side for a submenu.
 */
export function InlineThemeGroup() {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      <ThemeRadioGroup />
    </DropdownMenuGroup>
  );
}
