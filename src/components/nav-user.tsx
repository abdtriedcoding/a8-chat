"use client";

import type { FunctionReturnType } from "convex/server";
import {
  ChevronsUpDownIcon,
  CreditCardIcon,
  KeyboardIcon,
  LogInIcon,
  LogOutIcon,
  UserRoundCogIcon,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useOpenShortcutsHelp } from "@/components/keyboard-shortcuts";
import { useLeaveTemporaryThread } from "@/components/temporary-thread";
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
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { authClient } from "@/lib/auth-client";
import { clearLocalCopy } from "@/lib/local-copy";
import { initials } from "@/lib/initials";
import { api } from "../../convex/_generated/api";

/**
 * How long sign-out waits for the open temporary thread's delete. Mid-reply,
 * the delete conflicts with the reply's writes and can retry for many
 * seconds. The idle cron deletes the thread if the wait runs out.
 */
const TEMPORARY_THREAD_DELETE_WAIT_MS = 3000;

type CurrentUser = NonNullable<
  FunctionReturnType<typeof api.auth.getCurrentUser>
>;

export function NavUser() {
  const { data: user } = useQueryWithLocalCopy(api.auth.getCurrentUser, {});
  const { data: billingEnabled } = useQueryWithLocalCopy(
    api.billing.enabled,
    {},
  );
  const { isMobile } = useSidebar();
  const openShortcutsHelp = useOpenShortcutsHelp();
  const leaveTemporaryThread = useLeaveTemporaryThread();

  async function signOut() {
    const failed = () => {
      toast.error("Couldn't sign out. Please try again.");
    };
    // Signing out reloads the page, so the route never changes.
    await Promise.race([
      leaveTemporaryThread(),
      new Promise((resolve) =>
        setTimeout(resolve, TEMPORARY_THREAD_DELETE_WAIT_MS),
      ),
    ]);
    // Cleared first, so the page never leaves with the copy still there. If
    // sign-out fails, the next page load writes it again.
    await clearLocalCopy();
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

  if (user === undefined) return <NavUserSkeleton />;

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
              <DropdownMenuItem asChild>
                <Link href="/settings/account" prefetch>
                  <UserRoundCogIcon />
                  Account settings
                </Link>
              </DropdownMenuItem>
              {billingEnabled && (
                <DropdownMenuItem asChild>
                  <Link href="/settings/billing" prefetch>
                    <CreditCardIcon />
                    Billing
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void signOut()}
              >
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

/** The account menu's button in outline, while the user loads. */
export function NavUserSkeleton() {
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

function UserProfile({ user }: { user: CurrentUser }) {
  return (
    <>
      <Avatar>
        {user.image && <AvatarImage src={user.image} alt="" />}
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
