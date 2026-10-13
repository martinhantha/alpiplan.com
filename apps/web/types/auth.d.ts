export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  isSuperadmin: boolean;
  nextDayBriefingEnabled: boolean;
  /** Europe/Rome local time, minutes after midnight */
  nextDayBriefingMinutes: number;
}

export interface AuthMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: "ADMIN" | "STAFF" | "END_CUSTOMER";
  useDefaultDuration: boolean;
  teacherLabel: string;
  resourcesEnabled: boolean;
  speechRecognitionEnabled: boolean;
  autoCompleteAppointments: boolean;
  autoCompleteAfterMinutes: number;
  teacherProfileId: string | null;
}

export interface AuthSession {
  user: AuthUser;
  memberships: AuthMembership[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
