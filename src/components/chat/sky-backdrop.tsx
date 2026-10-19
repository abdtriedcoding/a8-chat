import { cn } from "cn";
import Image from "next/image";
import skyNight from "./sky-night.jpg";
import skyStars from "./sky-stars.png";
import sky from "./sky.jpg";

/**
 * Fades the photo out in the middle, where the heading and message box
 * sit, so they're on clear sky (bg-sky) instead of clouds.
 */
const CLEARING =
  "radial-gradient(ellipse 34% 38% at 50% 42%, transparent 35%, black 100%)";
/** The clearing's opposite: shows only the middle. */
const IN_CLEARING =
  "radial-gradient(ellipse 34% 38% at 50% 42%, black 35%, transparent 100%)";

/**
 * The sky behind a new chat. Dark mode shows the same photo graded to
 * night, with stars where the sky is clear. The clearing hides the photo's
 * stars too, so sky-stars.png puts the same stars back in the middle.
 *
 * The images load lazily, which skips the ones the theme hides, so each
 * theme fetches only its own sky.
 */
export function SkyBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none overflow-hidden bg-sky", className)}
    >
      <Image
        src={sky}
        alt=""
        fill
        fetchPriority="high"
        placeholder="blur"
        sizes="100vw"
        style={{ maskImage: CLEARING }}
        className="object-cover dark:hidden"
      />
      <Image
        src={skyNight}
        alt=""
        fill
        fetchPriority="high"
        placeholder="blur"
        sizes="100vw"
        style={{ maskImage: CLEARING }}
        className="hidden object-cover dark:block"
      />
      <Image
        src={skyStars}
        alt=""
        fill
        sizes="100vw"
        style={{ maskImage: IN_CLEARING }}
        className="hidden object-cover dark:block"
      />
    </div>
  );
}
