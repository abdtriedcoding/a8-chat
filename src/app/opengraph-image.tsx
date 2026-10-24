import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/icons/logo-mark";

// The link preview card for every page. Built once at build time. Satori
// can't read the theme's CSS variables or oklch, so the colors are the
// light theme's in hex.
export const alt = "a8: the AI chat that does the work in your apps";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLORS = {
  background: "#f1f5f9",
  foreground: "#2a3342",
  mutedForeground: "#58677d",
  primary: "#2563eb",
  highlight: "#bedcfe",
};

// Satori needs the font files themselves, which next/font doesn't expose, so
// they come from @fontsource/rubik.
function readRubik(weight: 400 | 700) {
  return readFile(
    join(
      process.cwd(),
      `node_modules/@fontsource/rubik/files/rubik-latin-${weight}-normal.woff`,
    ),
  );
}

export default async function OpengraphImage() {
  const [regular, bold] = await Promise.all([readRubik(400), readRubik(700)]);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: COLORS.background,
        color: COLORS.foreground,
        fontFamily: "Rubik",
      }}
    >
      {/* AppIcon and Logo, drawn again since Satori can't use Tailwind classes. */}
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            width: 88,
            height: 88,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 20,
            backgroundImage: "linear-gradient(to bottom, #0079e2, #5cb8f5)",
            color: "#fff",
          }}
        >
          <LogoMark width={60} height={60} />
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5 }}>
          a8
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 68,
          fontWeight: 700,
          letterSpacing: -1.5,
          lineHeight: 1.15,
        }}
      >
        <div>The AI chat that</div>
        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              padding: "0 8px",
              // Keeps the words in line with the line above.
              marginLeft: -8,
              color: COLORS.primary,
              backgroundColor: COLORS.highlight,
              transform: "rotate(-1deg)",
            }}
          >
            does the work
          </div>
          <div style={{ marginLeft: 18 }}>in your apps</div>
        </div>
      </div>
      <div style={{ fontSize: 32, color: COLORS.mutedForeground }}>
        Gmail, Google Calendar, Notion, Linear and more. Open source.
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Rubik", data: regular, weight: 400 },
        { name: "Rubik", data: bold, weight: 700 },
      ],
    },
  );
}
