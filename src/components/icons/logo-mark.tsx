export function LogoMark(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle
        cx="12"
        cy="7.25"
        r="4.25"
        stroke="currentColor"
        strokeOpacity={0.45}
        strokeWidth={3.5}
      />
      <circle cx="12" cy="16.25" r="5" stroke="currentColor" strokeWidth={3.5} />
    </svg>
  );
}
