export type AuthEmail = { subject: string; text: string; html: string };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function layout(heading: string, body: string, label: string, url: string) {
  const href = escapeHtml(url);
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<p style="font-size:20px;font-weight:700;margin:0 0 24px">a8</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
<p style="margin:0 0 24px;line-height:1.5">${escapeHtml(body)}</p>
<p style="margin:0 0 24px"><a href="${href}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>
<p style="margin:0;font-size:13px;color:#555;line-height:1.5">Or paste this link into your browser:<br><a href="${href}" style="color:#555;word-break:break-all">${href}</a></p>
</div>`;
}

export function verificationEmail(url: string): AuthEmail {
  const body = "Confirm your email to start using a8. The link expires in 1 hour.";
  return {
    subject: "Verify your email for a8",
    text: `${body}\n\n${url}\n\nIf you didn't ask for this, ignore this email.`,
    html: layout("Verify your email", body, "Verify email", url),
  };
}

export function resetPasswordEmail(url: string): AuthEmail {
  const body = "Use this link to set a new password. It expires in 30 minutes.";
  return {
    subject: "Reset your a8 password",
    text: `${body}\n\n${url}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.`,
    html: layout("Reset your password", body, "Reset password", url),
  };
}
