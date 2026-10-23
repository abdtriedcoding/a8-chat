import { useRef } from "react";

type AutoFocusHandlers = {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Handlers for a Radix dialog's content that send focus back to whatever
 * opened it. Radix only returns focus to a DialogTrigger, and most dialogs
 * here open from a menu item or a keyboard shortcut, so focus would drop to
 * the page body. The caller's own handlers run first, and one that prevents
 * the default turns this off.
 */
export function useReturnFocus({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: AutoFocusHandlers): AutoFocusHandlers {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      // Radix calls this before it moves focus into the dialog.
      opener.current = focusedOpener();
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      const target = opener.current;
      opener.current = null;
      // With no opener left, Radix focuses the dialog's trigger, if it has
      // one. A thread deleted from its own menu takes the menu button with it.
      if (event.defaultPrevented || !target?.isConnected) return;
      event.preventDefault();
      target.focus();
    },
  };
}

/**
 * The focused element. A menu item unmounts as its menu closes, so for one
 * this returns the button that opened the menu. Radix labels each menu by
 * that button.
 */
function focusedOpener() {
  // This relies on the menu's closing animation. Without one, the menu would
  // be gone before the dialog opens, and focus would be on the page body.
  let element = document.activeElement;
  let menu = element?.closest('[role="menu"]');
  while (menu) {
    element = document.getElementById(menu.getAttribute("aria-labelledby") ?? "");
    menu = element?.closest('[role="menu"]');
  }
  return element instanceof HTMLElement && element !== document.body
    ? element
    : null;
}
