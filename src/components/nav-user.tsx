"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronsUpDownIcon, LogInIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
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
import { api } from "../../convex/_generated/api";

type Viewer = NonNullable<FunctionReturnType<typeof api.users.viewer>>;

/** The signed-in user, with a menu to sign out. */
export function NavUser() {
  const { isLoading } = useConvexAuth();
  const viewer = useQuery(api.users.viewer, isLoading ? "skip" : {});
  const { isMobile } = useSidebar();
  // Sign-out ends the session before the page leaves, so users.viewer turns
  // null for a moment. Keep showing who was signed in until the redirect.
  const [signingOutAs, setSigningOutAs] = useState<Viewer | null>(null);
  const shown = signingOutAs ?? viewer;

  async function signOut(current: Viewer) {
    setSigningOutAs(current);
    try {
      // Sign-out succeeds even without a session, so an error response is a
      // real failure. The call rejects when the request itself fails.
      const { error } = await authClient.signOut();
      if (error) throw error;
    } catch {
      setSigningOutAs(null);
      toast.error("Couldn't sign out. Please try again.");
      return;
    }
    // A full load drops all client state; replace keeps the signed-in page
    // out of history.
    window.location.replace("/sign-in");
  }

  if (shown === undefined) {
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
  if (shown === null) {
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

  const profile = <ViewerProfile viewer={shown} />;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              disabled={signingOutAs !== null}
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
              <DropdownMenuItem onSelect={() => void signOut(shown)}>
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

function ViewerProfile({ viewer }: { viewer: Viewer }) {
  return (
    <>
      <Avatar>
        {viewer.image && <AvatarImage src={viewer.image} alt="" />}
        <AvatarFallback>{initials(viewer)}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{viewer.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {viewer.email}
        </span>
      </div>
    </>
  );
}

/** Up to two initials from the name, or the email's first letter. */
function initials({ name, email }: Viewer): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("");
  return (letters || Array.from(email)[0] || "?").toUpperCase();
}
