import { renderEmailLayout } from "./layout";
import {
  EMAIL_LOCALES,
  emailFooter,
  emailTemplates,
  type EmailLocale,
  type EmailTemplateId,
  type EmailTemplateVars,
} from "./templates";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const placeholder = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fill(text: string, vars: Record<string, string | null | undefined>, escape: boolean): string {
  return text.replace(placeholder, (_, key: string) => {
    const value = vars[key] ?? "";
    return escape ? escapeHtml(value) : value;
  });
}

export function normalizeEmailLocale(value: unknown): EmailLocale {
  const code = typeof value === "string" ? value.trim().slice(0, 2).toLowerCase() : "";
  return (EMAIL_LOCALES as readonly string[]).includes(code) ? (code as EmailLocale) : "de";
}

export function renderEmail<Id extends EmailTemplateId>(
  id: Id,
  locale: EmailLocale,
  vars: EmailTemplateVars<Id>,
): RenderedEmail {
  const template = emailTemplates[id];
  for (const key of template.requiredVars) {
    if (!vars[key]) {
      throw new Error(`E-Mail-Vorlage "${id}": Platzhalter "${key}" fehlt`);
    }
  }
  const copy = template.copy[locale] ?? template.copy.de;

  const subject = fill(copy.subject, vars, false);
  const heading = fill(copy.heading, vars, false);
  const paragraphs = copy.paragraphs.map((p) => fill(p, vars, false));
  const action = copy.action
    ? { label: fill(copy.action.label, vars, false), url: fill(copy.action.url, vars, false) }
    : undefined;
  const footnote = copy.footnote ? fill(copy.footnote, vars, false) : undefined;

  const html = renderEmailLayout({
    preheader: copy.preheader ? fill(copy.preheader, vars, true) : undefined,
    heading: escapeHtml(heading),
    paragraphsHtml: copy.paragraphs.map((p) => fill(p, vars, true)),
    action: action ? { label: escapeHtml(action.label), url: escapeHtml(action.url) } : undefined,
    footnoteHtml: copy.footnote ? fill(copy.footnote, vars, true) : undefined,
    footerHtml: escapeHtml(emailFooter[locale]),
  });

  const text = [
    heading,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(action ? [`${action.label}: ${action.url}`, ""] : []),
    ...(footnote ? [footnote, ""] : []),
    "--",
    emailFooter[locale],
  ].join("\n");

  return { subject, html, text };
}
