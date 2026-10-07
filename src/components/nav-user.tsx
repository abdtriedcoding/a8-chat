"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronsUpDownIcon,
  KeyboardIcon,
  LogInIcon,
  LogOutIcon,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useOpenShortcutsHelp } from "@/components/keyboard-shortcuts";
import { ThemeSubmenu } from "@/components/theme-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/initials";
import { api } from "../../convex/_generated/api";

type CurrentUser = NonNullable<
  FunctionReturnType<typeof api.auth.getCurrentUser>
>;

/**
 * The signed-in user, with a menu for the theme, the shortcuts help, and
 * signing out.
 */
export function NavUser() {
  const { isLoading } = useConvexAuth();
  const user = useQuery(api.auth.getCurrentUser, isLoading ? "skip" : {});
  const { isMobile } = useSidebar();
  const openShortcutsHelp = useOpenShortcutsHelp();

  async function signOut() {
    const failed = () => {
      toast.error("Couldn't sign out. Please try again.");
    };
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => window.location.replace("/sign-in"),
          onError: failed,
        },
      });
    } catch {
      // onError only sees error responses. A failed request rejects.
      failed();
    }
  }

  if (user === undefined) {
    return (
      <div aria-hidden="true" className="flex h-12 items-center gap-2 px-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  // The session ended while the page was open.
  if (user === null) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <Link href="/sign-in">
              <LogInIcon />
              <span>Sign in</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const profile = <UserProfile user={user} />;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {profile}
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel className="flex items-center gap-2 font-normal">
              {profile}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <ThemeSubmenu />
              <DropdownMenuItem onSelect={openShortcutsHelp}>
                <KeyboardIcon />
                Keyboard shortcuts
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => void signOut()}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function UserProfile({ user }: { user: CurrentUser }) {
  return (
    <>
      <Avatar>
        {user.pictureUrl && <AvatarImage src={user.pictureUrl} alt="" />}
        <AvatarFallback>{initials(user)}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {user.email}
        </span>
      </div>
    </>
  );
}
