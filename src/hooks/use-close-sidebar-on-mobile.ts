import { useSidebar } from "@/components/ui/sidebar";

/**
 * On phones the sidebar is a sheet over the page, and following a link
 * inside it doesn't close it. Call the returned function from those links'
 * onClick.
 */
export function useCloseSidebarOnMobile() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}
