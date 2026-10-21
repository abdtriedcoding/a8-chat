import { useEffect, useEffectEvent } from "react";

/**
 * Calls `onRestored` when the browser shows this page again from its
 * back-forward cache, such as after Back from Polar's checkout. React state
 * comes back as it was when the user left, spinners included.
 */
export function usePageRestored(onRestored: () => void) {
  const restored = useEffectEvent(onRestored);
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) restored();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
}
