/**
 * E-Mail-Vorlagen. Neue Vorlage = neuer Eintrag in `emailTemplates` (Texte je Sprache).
 * Platzhalter `{{name}}` werden beim Rendern ersetzt (im HTML automatisch escaped);
 * `requiredVars` listet die Platzhalter, ohne die die Mail nicht versendet wird.
 */

export const EMAIL_LOCALES = ["de", "en", "it"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export interface EmailTemplateCopy {
  subject: string;
  preheader?: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

export interface EmailTemplateDefinition<Var extends string = string> {
  requiredVars: readonly Var[];
  copy: Record<EmailLocale, EmailTemplateCopy>;
}

function defineEmailTemplate<const Var extends string>(
  definition: EmailTemplateDefinition<Var>,
): EmailTemplateDefinition<Var> {
  return definition;
}

export const emailFooter: Record<EmailLocale, string> = {
  de: "Diese E-Mail wurde automatisch von Alpiplan versendet.",
  en: "This email was sent automatically by Alpiplan.",
  it: "Questa e-mail è stata inviata automaticamente da Alpiplan.",
};

export const emailTemplates = {
  "password-reset": defineEmailTemplate({
    requiredVars: ["actionUrl", "expiresInText"],
    copy: {
      de: {
        subject: "Passwort zurücksetzen",
        preheader: "Lege ein neues Passwort für dein Alpiplan-Konto fest.",
        heading: "Passwort zurücksetzen",
        paragraphs: [
          "Hallo {{name}},",
          "für dein Alpiplan-Konto wurde ein neues Passwort angefordert. Über den folgenden Button kannst du ein neues Passwort festlegen.",
        ],
        action: { label: "Neues Passwort festlegen", url: "{{actionUrl}}" },
        footnote:
          "Der Link ist {{expiresInText}} gültig und kann nur einmal verwendet werden. Falls du das nicht warst, kannst du diese E-Mail ignorieren – dein Passwort bleibt unverändert.",
      },
      en: {
        subject: "Reset your password",
        preheader: "Choose a new password for your Alpiplan account.",
        heading: "Reset your password",
        paragraphs: [
          "Hi {{name}},",
          "a new password was requested for your Alpiplan account. Use the button below to choose a new password.",
        ],
        action: { label: "Choose new password", url: "{{actionUrl}}" },
        footnote:
          "The link is valid for {{expiresInText}} and can only be used once. If this wasn't you, you can ignore this email – your password stays unchanged.",
      },
      it: {
        subject: "Reimposta la password",
        preheader: "Scegli una nuova password per il tuo account Alpiplan.",
        heading: "Reimposta la password",
        paragraphs: [
          "Ciao {{name}},",
          "è stata richiesta una nuova password per il tuo account Alpiplan. Usa il pulsante qui sotto per sceglierne una nuova.",
        ],
        action: { label: "Scegli nuova password", url: "{{actionUrl}}" },
        footnote:
          "Il link è valido per {{expiresInText}} e può essere usato una sola volta. Se non sei stato tu, ignora questa e-mail – la password resta invariata.",
      },
    },
  }),

  "password-setup": defineEmailTemplate({
    requiredVars: ["actionUrl", "expiresInText"],
    copy: {
      de: {
        subject: "Dein Zugang zu Alpiplan",
        preheader: "Lege dein Passwort fest und melde dich an.",
        heading: "Willkommen bei Alpiplan",
        paragraphs: [
          "Hallo {{name}},",
          "{{inviterName}} hat einen Zugang für dich eingerichtet ({{tenantName}}). Lege über den folgenden Button dein Passwort fest – danach kannst du dich mit {{email}} anmelden.",
        ],
        action: { label: "Passwort festlegen", url: "{{actionUrl}}" },
        footnote: "Der Link ist {{expiresInText}} gültig und kann nur einmal verwendet werden.",
      },
      en: {
        subject: "Your Alpiplan access",
        preheader: "Set your password and sign in.",
        heading: "Welcome to Alpiplan",
        paragraphs: [
          "Hi {{name}},",
          "{{inviterName}} set up an account for you ({{tenantName}}). Use the button below to set your password – then sign in with {{email}}.",
        ],
        action: { label: "Set password", url: "{{actionUrl}}" },
        footnote: "The link is valid for {{expiresInText}} and can only be used once.",
      },
      it: {
        subject: "Il tuo accesso ad Alpiplan",
        preheader: "Imposta la password e accedi.",
        heading: "Benvenuto in Alpiplan",
        paragraphs: [
          "Ciao {{name}},",
          "{{inviterName}} ha creato un accesso per te ({{tenantName}}). Usa il pulsante qui sotto per impostare la password – poi accedi con {{email}}.",
        ],
        action: { label: "Imposta password", url: "{{actionUrl}}" },
        footnote: "Il link è valido per {{expiresInText}} e può essere usato una sola volta.",
      },
    },
  }),
} satisfies Record<string, EmailTemplateDefinition>;

export type EmailTemplateId = keyof typeof emailTemplates;

export type EmailTemplateVars<Id extends EmailTemplateId> = {
  [K in (typeof emailTemplates)[Id]["requiredVars"][number]]: string;
} & Record<string, string | null | undefined>;
