import "./load-root-env";
import nodemailer, { type Transporter } from "nodemailer";
import { renderEmail } from "~/server/email/render";
import type { EmailLocale, EmailTemplateId, EmailTemplateVars } from "~/server/email/templates";

let transporter: Transporter | null | undefined;

function smtpTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    transporter = null;
    return transporter;
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  return transporter;
}

export function isMailConfigured(): boolean {
  return smtpTransporter() !== null;
}

function mailFrom(): string {
  return process.env.MAIL_FROM?.trim() || "Alpiplan <no-reply@alpiplan.com>";
}

export interface SendTemplatedEmailInput<Id extends EmailTemplateId> {
  to: string;
  template: Id;
  locale: EmailLocale;
  vars: EmailTemplateVars<Id>;
}

/** Returns false when SMTP is not configured (mail is then only written to the server log). */
export async function sendTemplatedEmail<Id extends EmailTemplateId>(
  input: SendTemplatedEmailInput<Id>,
): Promise<boolean> {
  const rendered = renderEmail(input.template, input.locale, input.vars);
  const transport = smtpTransporter();
  if (!transport) {
    console.warn(
      `[mail] SMTP_HOST nicht gesetzt – E-Mail "${input.template}" an ${input.to} nicht versendet.\n` +
        `Betreff: ${rendered.subject}\n${rendered.text}`,
    );
    return false;
  }
  await transport.sendMail({
    from: mailFrom(),
    replyTo: process.env.MAIL_REPLY_TO?.trim() || undefined,
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  return true;
}
