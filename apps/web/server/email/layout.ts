export interface EmailLayoutInput {
  /** hidden preview text shown by most mail clients next to the subject */
  preheader?: string;
  heading: string;
  /** already-escaped HTML paragraphs */
  paragraphsHtml: string[];
  action?: { label: string; url: string };
  /** already-escaped HTML, rendered small below the button */
  footnoteHtml?: string;
  footerHtml: string;
}

const BRAND = "#5b38d6";
const INK = "#1f1347";

export function renderEmailLayout(input: EmailLayoutInput): string {
  const paragraphs = input.paragraphsHtml
    .map((html) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333;">${html}</p>`)
    .join("");

  const action = input.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
        <tr><td style="border-radius:8px;background:${BRAND};">
          <a href="${input.action.url}" target="_blank"
             style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#fff;text-decoration:none;border-radius:8px;">
            ${input.action.label}
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:#777;word-break:break-all;">
        ${input.action.url}
      </p>`
    : "";

  const footnote = input.footnoteHtml
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#666;">${input.footnoteHtml}</p>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${input.heading}</title>
</head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${input.preheader ?? ""}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:${INK};padding:20px 32px;">
        <span style="font-size:20px;font-weight:700;color:#fff;letter-spacing:0.2px;">Alpiplan</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${INK};">${input.heading}</h1>
        ${paragraphs}
        ${action}
        ${footnote}
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#999;">${input.footerHtml}</p>
  </td></tr>
</table>
</body>
</html>`;
}
