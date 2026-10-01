<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { $fetch } from "ofetch";
import type { CallHint } from "@alpiplan/device-capabilities";
import { isCallHintsOptIn } from "@alpiplan/device-capabilities";
import { useAuth } from "../composables/useAuth";
import { useDeviceCapabilities } from "../composables/useDeviceCapabilities";
import { useDeviceContactLookup } from "../composables/useDeviceContactLookup";
import type { ClarifyingQuestion, ParseIntentResponse, ParsedAppointmentIntent } from "../types/assistant";
import {
  fallbackContactDisplayName,
  resolveAppointmentPhone,
  resolveContactOrganization,
} from "../utils/appointment-contact";
import { commitUtterance, withLiveInterim } from "../utils/speech-transcript";
import { isNativeAndroidSpeech, startNativeSpeech } from "../utils/native-speech";

type WebSpeechRecognitionEventResult = {
  isFinal: boolean;
  0: { transcript: string };
};
type WebSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<WebSpeechRecognitionEventResult>;
};
type WebSpeechRecognitionErrorEvent = { error?: string; message?: string };
interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type WebSpeechCtor = new () => WebSpeechRecognition;

interface TeacherOption {
  id: string;
  displayName: string;
}
interface ResourceOption {
  id: string;
  name: string;
  capacity: number;
}
interface LessonTypeOption {
  id: string;
  name: string;
  defaultDurationMin: number | null;
}
interface CustomerOption {
  id: string;
  displayName: string;
  phones?: { e164: string | null; raw: string | null; isPrimary: boolean }[];
}
interface SchedulingOptions {
  teachers: TeacherOption[];
  resources: ResourceOption[];
  lessonTypes: LessonTypeOption[];
  customers: CustomerOption[];
  defaultTeacherId: string | null;
  defaultLessonTypeId: string | null;
  teacherLabel: string;
  resourcesEnabled: boolean;
  businessTimeZone: string;
}
interface AppointmentDto {
  id: string;
  version?: number;
  startsAt: string;
  endsAt: string;
  appointmentContactText: string | null;
  appointmentPhoneRaw?: string | null;
  appointmentPhoneE164?: string | null;
  unstructuredNote?: string | null;
  teacher: TeacherOption | null;
  teachers?: TeacherOption[] | null;
  resource: ResourceOption | null;
  lessonType: LessonTypeOption | null;
  customer: CustomerOption | null;
}

const props = defineProps<{
  appointment?: AppointmentDto | null;
  initialContactText?: string;
  initialTeacherId?: string;
  initialLessonTypeId?: string;
  startWithVoice?: boolean;
}>();

const emit = defineEmits<{
  saved: [appointment: AppointmentDto];
  cancel: [];
}>();

const { primaryTenant, canManageTenant } = useAuth();
const { device } = useDeviceCapabilities();

const teacherLabel = computed(
  () => options.value?.teacherLabel || primaryTenant.value?.teacherLabel || "Lehrer",
);
const resourcesEnabled = computed(
  () => options.value?.resourcesEnabled ?? primaryTenant.value?.resourcesEnabled ?? true,
);
const speechRecognitionEnabled = computed(
  () => primaryTenant.value?.speechRecognitionEnabled ?? false,
);

const isEditing = computed(() => Boolean(props.appointment?.id));
const text = ref(props.appointment?.appointmentContactText ?? props.initialContactText ?? "");
const options = ref<SchedulingOptions | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const conflictType = ref("");
const saved = ref<AppointmentDto | null>(null);
const initialStart = nextFullHour();

const speechSupported = ref(false);
const speechListening = ref(false);
const speechInterim = ref("");
const speechError = ref("");
const parseLoading = ref(false);
const parseHint = ref("");
const questions = ref<ClarifyingQuestion[]>([]);
const parseAnswers = reactive<Record<string, string>>({});
const passengerName = ref("");
const callHints = ref<CallHint[]>([]);
const pickingContact = ref(false);
const savingDeviceContact = ref(false);
const removingDeviceContact = ref(false);
const deviceContactHint = ref("");
const STOP_COMMAND_RE =
  /(?:^|\s)(?:bitte\s+)?(?:speichern|fertig|ok(?:ay)?|o\.?\s*k\.?|stopp|stop|ende)(?:\s*[.!,])?\s*$/i;

let recognition: WebSpeechRecognition | null = null;
let speechTextBase = "";
let parseAfterListen = false;
let speechStopping = false;
let speechRestartTimer: ReturnType<typeof setTimeout> | null = null;
let stopNativeSpeech: (() => Promise<void>) | null = null;

function clearSpeechRestart() {
  if (speechRestartTimer == null) return;
  clearTimeout(speechRestartTimer);
  speechRestartTimer = null;
}

function collectSpoken(event: WebSpeechRecognitionEvent): { finalText: string; interimText: string } {
  let finalText = "";
  let interimText = "";
  for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    const transcript = (result[0]?.transcript ?? "").replace(/\s+/g, " ").trim();
    if (!transcript) continue;
    if (result.isFinal) finalText = commitUtterance(finalText, transcript);
    else interimText = transcript;
  }
  return { finalText, interimText };
}

function applySpoken(finalText: string, interimText: string, allowStop = true) {
  const committed = commitUtterance(speechTextBase, finalText);
  const combined = withLiveInterim(committed, interimText);
  const { cleaned, stop } = stripStopCommand(combined);
  text.value = cleaned;
  speechInterim.value = interimText;
  if (!stop || !allowStop) return;
  speechTextBase = cleaned;
  speechInterim.value = "";
  stopListeningWithParse();
}

function stripStopCommand(value: string): { cleaned: string; stop: boolean } {
  const match = STOP_COMMAND_RE.exec(value);
  if (!match) return { cleaned: value.replace(/\s+/g, " ").trim(), stop: false };
  return { cleaned: value.slice(0, match.index).replace(/\s+/g, " ").trim(), stop: true };
}

function stopListeningWithParse() {
  if (speechStopping) return;
  speechStopping = true;
  speechListening.value = false;
  speechInterim.value = "";
  parseAfterListen = true;
  clearSpeechRestart();
  if (stopNativeSpeech) {
    const stop = stopNativeSpeech;
    stopNativeSpeech = null;
    void stop().then(() => {
      parseAfterListen = false;
      speechStopping = false;
      void parseFromText();
    });
    return;
  }
  if (!recognition) {
    parseAfterListen = false;
    speechStopping = false;
    void parseFromText();
    return;
  }
  try {
    recognition.stop();
  } catch {
    parseAfterListen = false;
    speechStopping = false;
    void parseFromText();
  }
}

function getSpeechCtor(): WebSpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: WebSpeechCtor;
    webkitSpeechRecognition?: WebSpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function setupSpeech() {
  if (isNativeAndroidSpeech()) {
    speechSupported.value = true;
  }
  const Ctor = getSpeechCtor();
  if (!Ctor) {
    return;
  }
  speechSupported.value = true;
  recognition = new Ctor();
  recognition.lang = "de-DE";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.onresult = (event) => {
    if (speechStopping) return;
    const { finalText, interimText } = collectSpoken(event);
    applySpoken(finalText, interimText, Boolean(finalText));
  };
  recognition.onerror = (event) => {
    if (event.error === "aborted" || event.error === "no-speech") return;
    speechError.value =
      event.error === "not-allowed"
        ? device.value.platform === "web"
          ? "Mikrofon-Zugriff verweigert – bitte im Browser erlauben."
          : "Mikrofon-Zugriff verweigert – bitte in den App-Einstellungen erlauben."
        : event.message || event.error || "Sprachaufnahme fehlgeschlagen.";
  };
  recognition.onend = () => {
    speechInterim.value = "";
    const shouldParse = parseAfterListen;
    parseAfterListen = false;
    if (speechStopping || shouldParse) {
      speechStopping = false;
      speechListening.value = false;
      if (shouldParse) void parseFromText();
      return;
    }
    if (speechListening.value && recognition) {
      speechTextBase = text.value.trim();
      speechRestartTimer = setTimeout(() => {
        speechRestartTimer = null;
        if (!speechListening.value || speechStopping || !recognition) return;
        try {
          recognition.start();
        } catch {
          speechListening.value = false;
        }
      }, 200);
      return;
    }
    speechListening.value = false;
    speechStopping = false;
  };
}

async function toggleSpeech() {
  if (!speechRecognitionEnabled.value) return;
  speechError.value = "";
  if (speechListening.value) {
    speechListening.value = false;
    clearSpeechRestart();
    if (stopNativeSpeech) {
      const stop = stopNativeSpeech;
      stopNativeSpeech = null;
      await stop();
      return;
    }
    recognition?.stop();
    return;
  }
  const micOk = await device.value.requestMicrophonePermission();
  if (!micOk) {
    speechError.value =
      device.value.platform === "web"
        ? "Mikrofon-Zugriff verweigert – bitte im Browser erlauben."
        : "Mikrofon-Zugriff verweigert – bitte in den App-Einstellungen erlauben.";
    return;
  }
  speechTextBase = text.value.trim();
  speechInterim.value = "";
  speechStopping = false;
  clearSpeechRestart();
  if (isNativeAndroidSpeech()) {
    try {
      stopNativeSpeech = await startNativeSpeech({
        onTranscript: (transcript, isFinal) => {
          if (speechStopping) return;
          if (isFinal) {
            applySpoken(transcript, "", true);
            if (speechListening.value) speechTextBase = text.value.trim();
            return;
          }
          applySpoken("", transcript, false);
        },
        onSessionEnd: () => {
          if (speechStopping) return;
          speechTextBase = text.value.trim();
          speechInterim.value = "";
        },
        onError: (message) => {
          speechError.value = message;
        },
      });
      speechListening.value = true;
    } catch (e) {
      stopNativeSpeech = null;
      if (recognition) {
        try {
          recognition.start();
          speechListening.value = true;
          return;
        } catch {
          // Fall through to the error below.
        }
      }
      const err = e as { message?: string };
      speechError.value = err.message || "Sprachaufnahme konnte nicht gestartet werden.";
      speechListening.value = false;
    }
    return;
  }
  if (!recognition) return;
  try {
    recognition.start();
    speechListening.value = true;
  } catch (e) {
    const err = e as { message?: string };
    speechError.value = err.message || "Sprachaufnahme konnte nicht gestartet werden.";
    speechListening.value = false;
  }
}

function toggleVoiceAssistant() {
  if (!speechRecognitionEnabled.value) {
    void parseFromText();
    return;
  }
  speechError.value = "";
  parseHint.value = "";
  if (!speechSupported.value && !recognition) {
    void parseFromText();
    return;
  }
  if (speechListening.value) {
    stopListeningWithParse();
    return;
  }
  Object.keys(parseAnswers).forEach((key) => delete parseAnswers[key]);
  void toggleSpeech();
}

function applyParsed(
  parsed: ParsedAppointmentIntent,
  suggested?: Record<string, unknown>,
) {
  if (parsed.contactText) text.value = parsed.contactText;
  const slotSuggested = suggested?.slotSource === "priority";
  if (parsed.date && (!isEditing.value || !slotSuggested)) form.date = parsed.date;
  if (parsed.time && (!isEditing.value || !slotSuggested)) form.time = parsed.time;
  if (parsed.durationMinutes) form.durationMinutes = parsed.durationMinutes;
  if (
    canManageTenant.value &&
    parsed.teacherId &&
    (!isEditing.value || !slotSuggested || !form.teacherIds.length)
  ) {
    form.teacherIds = [parsed.teacherId];
  }
  if (parsed.resourceId) form.resourceId = parsed.resourceId;
  if (parsed.lessonTypeId) form.lessonTypeId = parsed.lessonTypeId;
  if (parsed.phone) form.phone = parsed.phone;
  if (parsed.note) form.note = parsed.note;
  if (parsed.customerId) {
    form.customerId = parsed.customerId;
    const known = options.value?.customers.find((item) => item.id === parsed.customerId);
    passengerName.value = parsed.customerName || known?.displayName || passengerName.value;
    if (parsed.customerName && options.value && !known) {
      options.value.customers = [
        ...options.value.customers,
        { id: parsed.customerId, displayName: parsed.customerName },
      ];
    }
  } else if (parsed.customerName) {
    form.customerId = "";
    passengerName.value = parsed.customerName;
  } else {
    form.customerId = "";
    passengerName.value = "";
  }
}

async function parseFromText() {
  if (!primaryTenant.value || !text.value.trim()) return;
  parseLoading.value = true;
  parseHint.value = "";
  error.value = "";
  try {
    const result = await $fetch<ParseIntentResponse>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/assistant/parse-intent`,
      {
        method: "POST",
        credentials: "include",
        body: { text: text.value, answers: { ...parseAnswers } },
      },
    );
    applyParsed(result.parsed, result.suggestedDefaults);
    questions.value = result.clarifyingQuestions ?? [];
    const passenger = result.parsed.customerName;
    const slot = result.suggestedDefaults;
    const slotHint = (() => {
      if (isEditing.value || slot?.slotSource !== "priority" || typeof slot.date !== "string" || typeof slot.time !== "string") {
        return "";
      }
      const when = new Intl.DateTimeFormat("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(`${slot.date}T${slot.time}`));
      const who = typeof slot.teacherName === "string" && slot.teacherName ? ` · ${slot.teacherName}` : "";
      return ` Nächster freier Termin (Priorität ${Number(slot.priority) || 0}): ${when}${who}.`;
    })();
    parseHint.value = questions.value.length
      ? "Bitte noch kurz klären – danach sind die Felder vollständig."
      : passenger
        ? result.parsed.customerId
          ? `Felder übernommen. Passagier gefunden: ${passenger}. Bitte prüfen und speichern.${slotHint}`
          : `Felder übernommen. Passagier „${passenger}“ wird beim Speichern als neuer Kunde angelegt.${slotHint}`
        : `Felder übernommen, aber kein Passagier erkannt. Name bitte unten eintragen.${slotHint}`;
  } catch (e: unknown) {
    error.value = apiErrorMessage(e);
  } finally {
    parseLoading.value = false;
  }
}

function answerQuestion(questionId: string, value: string) {
  parseAnswers[questionId] = value;
  void parseFromText();
}

onBeforeUnmount(() => {
  speechListening.value = false;
  speechStopping = true;
  clearSpeechRestart();
  if (stopNativeSpeech) {
    const stop = stopNativeSpeech;
    stopNativeSpeech = null;
    void stop();
  }
  if (recognition) {
    try {
      recognition.abort();
    } catch {
      // ignore
    }
  }
});

function assignedTeacherIds(appointment?: AppointmentDto | null, fallbackId?: string) {
  const fromList = appointment?.teachers?.map((item) => item.id).filter(Boolean) ?? [];
  if (fromList.length) return fromList;
  if (appointment?.teacher?.id) return [appointment.teacher.id];
  if (fallbackId) return [fallbackId];
  return [];
}

const form = reactive({
  date: toDateInput(props.appointment ? new Date(props.appointment.startsAt) : initialStart),
  time: toTimeInput(props.appointment ? new Date(props.appointment.startsAt) : initialStart),
  durationMinutes: props.appointment
    ? durationMinutesFromRange(props.appointment.startsAt, props.appointment.endsAt)
    : 60,
  teacherIds: assignedTeacherIds(props.appointment, props.initialTeacherId),
  resourceId: props.appointment?.resource?.id ?? "",
  lessonTypeId: props.appointment?.lessonType?.id ?? props.initialLessonTypeId ?? "",
  customerId: props.appointment?.customer?.id ?? "",
  phone: props.appointment ? resolveAppointmentPhone(props.appointment) ?? "" : "",
  note: props.appointment?.unstructuredNote ?? "",
});
let hydratingForm = false;

function toggleTeacher(id: string) {
  const index = form.teacherIds.indexOf(id);
  if (index >= 0) {
    form.teacherIds.splice(index, 1);
    return;
  }
  form.teacherIds.push(id);
}

const colleagueNames = computed(() => {
  const mine = primaryTenant.value?.teacherProfileId;
  const list = props.appointment?.teachers?.length
    ? props.appointment.teachers
    : props.appointment?.teacher
      ? [props.appointment.teacher]
      : [];
  return list
    .filter((item) => item.id && item.id !== mine)
    .map((item) => item.displayName)
    .filter(Boolean)
    .join(", ");
});

if (props.appointment?.customer?.displayName || props.appointment?.appointmentContactText) {
  passengerName.value = props.appointment.customer?.displayName ?? props.appointment.appointmentContactText ?? "";
}

const durationOptions = [30, 45, 60, 90, 120];
const useTypeDuration = computed(() => primaryTenant.value?.useDefaultDuration ?? true);
const CUSTOMER_SUGGEST_MIN_LEN = 3;

const customerSuggestions = computed(() => {
  const query = passengerName.value.trim();
  if (query.length < CUSTOMER_SUGGEST_MIN_LEN) return [];
  const q = query.toLowerCase();
  return (options.value?.customers ?? [])
    .filter((customer) => customer.displayName.toLowerCase().includes(q))
    .slice(0, 8);
});

const showCustomerSuggestions = computed(() => {
  const query = passengerName.value.trim();
  if (query.length < CUSTOMER_SUGGEST_MIN_LEN || !customerSuggestions.value.length) return false;
  const selected = form.customerId
    ? options.value?.customers.find((item) => item.id === form.customerId)
    : null;
  if (selected && selected.displayName === query) return false;
  return true;
});

const willCreateCustomer = computed(
  () => Boolean(passengerName.value.trim().length >= 2) && !form.customerId,
);

function pickCustomerSuggestion(customer: CustomerOption) {
  form.customerId = customer.id;
  passengerName.value = customer.displayName;
}
const canPickContact = computed(() => device.value.features.pickContact);
const { lookup: deviceContactLookup, checking: checkingDeviceContact, canDelete: canDeleteDeviceContactFeature, savedOnDevice, refresh: refreshDeviceContact } =
  useDeviceContactLookup(() => form.phone);
const canSaveDeviceContact = computed(
  () =>
    device.value.features.saveContact &&
    Boolean(form.phone.trim()) &&
    Boolean(passengerName.value.trim() || text.value.trim()) &&
    !savedOnDevice.value,
);
const canRemoveDeviceContact = computed(
  () =>
    canDeleteDeviceContactFeature.value && savedOnDevice.value && Boolean(form.phone.trim()),
);
const canManageDeviceContact = computed(
  () =>
    canSaveDeviceContact.value ||
    canRemoveDeviceContact.value ||
    Boolean(deviceContactHint.value) ||
    (checkingDeviceContact.value && Boolean(form.phone.trim())),
);
const deviceContactStatusLabel = computed(() => {
  if (deviceContactHint.value) return "";
  if (!savedOnDevice.value) return "";
  return deviceContactLookup.value.match?.googleSynced
    ? "Bereits in Google Kontakte gespeichert."
    : "Bereits im Telefon gespeichert.";
});
const showCallHintsOptInHint = computed(
  () => device.value.features.callHints && !isCallHintsOptIn() && !callHints.value.length,
);

function applyCallHint(hint: CallHint) {
  const phone = hint.e164 || hint.raw;
  if (phone) form.phone = phone;
}

function formatCallHintTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function loadCallHints() {
  if (!device.value.features.callHints || !isCallHintsOptIn()) {
    callHints.value = [];
    return;
  }
  try {
    callHints.value = await device.value.getRecentCallHints(2);
  } catch {
    callHints.value = [];
  }
}

async function pickDeviceContact() {
  pickingContact.value = true;
  deviceContactHint.value = "";
  try {
    const contact = await device.value.pickContact();
    if (!contact) return;
    if (contact.phone) form.phone = contact.phone;
    if (contact.name && !passengerName.value.trim()) {
      passengerName.value = contact.name;
    }
    await refreshDeviceContact();
  } catch {
    deviceContactHint.value = "Kontakt konnte nicht gelesen werden.";
  } finally {
    pickingContact.value = false;
  }
}

async function saveDeviceContact() {
  if (!canSaveDeviceContact.value) return;
  savingDeviceContact.value = true;
  deviceContactHint.value = "";
  try {
    const organization = resolveContactOrganization(primaryTenant.value?.tenantName);
    await device.value.saveOrUpdateDeviceContact({
      displayName:
        passengerName.value.trim() ||
        text.value.trim() ||
        fallbackContactDisplayName(primaryTenant.value?.tenantName),
      phoneE164: form.phone.trim() || undefined,
      organization,
    });
    await refreshDeviceContact();
    if (device.value.platform === "web") {
      deviceContactHint.value = `vCard heruntergeladen — auf dem Telefon importieren (Organisation: ${organization}).`;
    } else if (deviceContactLookup.value.match?.googleSynced) {
      deviceContactHint.value = "Nummer ist schon in Google Kontakte gespeichert.";
    } else {
      deviceContactHint.value = `Kontakt lokal unter „${organization}“ gespeichert, nicht im Google-Konto.`;
    }
  } catch {
    deviceContactHint.value = "Kontakt konnte nicht gespeichert werden.";
  } finally {
    savingDeviceContact.value = false;
  }
}

async function removeDeviceContact() {
  if (!canRemoveDeviceContact.value) return;
  const google = deviceContactLookup.value.match?.googleSynced;
  const ok = window.confirm(
    google
      ? "Dieser Kontakt ist mit Google Kontakte synchronisiert und wird dort ebenfalls gelöscht. Fortfahren?"
      : "Diesen Kontakt wirklich vom Telefon entfernen?",
  );
  if (!ok) return;
  removingDeviceContact.value = true;
  deviceContactHint.value = "";
  try {
    await device.value.deleteDeviceContact(form.phone.trim());
    await refreshDeviceContact();
    deviceContactHint.value = "Kontakt wurde vom Telefon entfernt.";
  } catch {
    deviceContactHint.value = "Kontakt konnte nicht entfernt werden.";
  } finally {
    removingDeviceContact.value = false;
  }
}

watch(passengerName, (name) => {
  if (hydratingForm || isEditing.value) return;
  const selected = options.value?.customers.find((item) => item.id === form.customerId);
  if (!selected) return;
  if (name.trim() !== selected.displayName) {
    form.customerId = "";
  }
});

const selectedLessonType = computed(() =>
  options.value?.lessonTypes.find((item) => item.id === form.lessonTypeId) ?? null,
);

const effectiveDuration = computed(() => form.durationMinutes || selectedLessonType.value?.defaultDurationMin || 60);

const captureSelectClass =
  "w-full min-h-10 rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2.5 text-sm";
const captureInputUi = { base: "min-h-10 py-2.5" };

const canSave = computed(() =>
  Boolean(primaryTenant.value && form.date && form.time && (text.value.trim() || passengerName.value.trim() || form.customerId)),
);

function durationMinutesFromRange(startsAt: string, endsAt: string) {
  const minutes = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
  return minutes > 0 ? minutes : 60;
}

function fillFromAppointment(appointment: AppointmentDto) {
  hydratingForm = true;
  const startsAt = new Date(appointment.startsAt);
  text.value = appointment.appointmentContactText ?? "";
  form.date = toDateInput(startsAt);
  form.time = toTimeInput(startsAt);
  form.durationMinutes = durationMinutesFromRange(appointment.startsAt, appointment.endsAt);
  form.teacherIds = assignedTeacherIds(appointment);
  form.resourceId = appointment.resource?.id ?? "";
  form.lessonTypeId = appointment.lessonType?.id ?? "";
  form.customerId = appointment.customer?.id ?? "";
  form.phone = resolveAppointmentPhone(appointment) ?? "";
  form.note = appointment.unstructuredNote ?? "";
  passengerName.value = appointment.customer?.displayName ?? appointment.appointmentContactText ?? "";
  hydratingForm = false;
}

function nextFullHour() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function apiErrorMessage(e: unknown) {
  const err = e as {
    data?: { message?: string; statusMessage?: string; data?: { message?: string; details?: Record<string, unknown> } };
    statusMessage?: string;
  };
  const details = err.data?.data?.details;
  conflictType.value = typeof details?.conflictType === "string" ? details.conflictType : "";
  return (
    err.data?.data?.message ||
    err.data?.message ||
    err.data?.statusMessage ||
    err.statusMessage ||
    "Aktion fehlgeschlagen"
  );
}

async function loadOptions() {
  if (!primaryTenant.value) return;
  loading.value = true;
  error.value = "";
  try {
    options.value = await $fetch<SchedulingOptions>(
      `/api/v1/tenants/${primaryTenant.value.tenantId}/scheduling/options`,
      { credentials: "include" },
    );
    if (props.appointment) {
      fillFromAppointment(props.appointment);
    } else {
      if (!form.teacherIds.length) {
        const preferred = options.value.defaultTeacherId;
        const fallback =
          preferred && options.value.teachers.some((teacher) => teacher.id === preferred)
            ? preferred
            : (options.value.teachers[0]?.id ?? "");
        if (fallback) form.teacherIds = [fallback];
      }
      if (resourcesEnabled.value) {
        form.resourceId ||= options.value.resources[0]?.id ?? "";
      } else {
        form.resourceId = "";
      }
      if (!form.lessonTypeId) {
        const preferred = options.value.defaultLessonTypeId;
        form.lessonTypeId =
          preferred && options.value.lessonTypes.some((lessonType) => lessonType.id === preferred)
            ? preferred
            : (options.value.lessonTypes[0]?.id ?? "");
      }
      const selectedType = options.value.lessonTypes.find((item) => item.id === form.lessonTypeId);
      if (selectedType?.defaultDurationMin) {
        form.durationMinutes = selectedType.defaultDurationMin;
      }
    }
  } catch (e: unknown) {
    error.value = apiErrorMessage(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => form.lessonTypeId,
  (lessonTypeId) => {
    if (hydratingForm) return;
    const lessonType = options.value?.lessonTypes.find((item) => item.id === lessonTypeId);
    if (lessonType?.defaultDurationMin) {
      form.durationMinutes = lessonType.defaultDurationMin;
    }
  },
);

watch(
  () => primaryTenant.value?.tenantId,
  () => {
    loadOptions();
  },
);

async function saveAppointment() {
  if (!primaryTenant.value || !canSave.value) return;

  const startsAt = localDateTime(form.date, form.time);
  const endsAt = new Date(startsAt.getTime() + effectiveDuration.value * 60_000);
  saving.value = true;
  error.value = "";
  conflictType.value = "";
  saved.value = null;

  try {
    let customerId = form.customerId || undefined;
    if (!customerId && passengerName.value.trim().length >= 2) {
      const created = await $fetch<{ id: string; displayName: string }>(
        `/api/v1/tenants/${primaryTenant.value.tenantId}/customers`,
        {
          method: "POST",
          credentials: "include",
          body: {
            displayName: passengerName.value.trim(),
            customerSource: "from_appointment",
            phones: form.phone
              ? [{ e164: form.phone, raw: form.phone, isPrimary: true }]
              : [],
          },
        },
      );
      customerId = created.id;
      if (options.value && !options.value.customers.some((item) => item.id === created.id)) {
        options.value.customers = [
          ...options.value.customers,
          { id: created.id, displayName: created.displayName },
        ];
      }
      form.customerId = created.id;
      passengerName.value = created.displayName;
    }

    const phoneValue = form.phone.trim();
    const payload: Record<string, unknown> = {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      lessonTypeId: form.lessonTypeId || null,
      resourceId: resourcesEnabled.value ? form.resourceId || null : undefined,
      customerId: customerId || null,
      customerName: passengerName.value.trim() || undefined,
      appointmentContactText: text.value,
      appointmentPhoneRaw: phoneValue || null,
      appointmentPhoneE164: phoneValue.startsWith("+") ? phoneValue : null,
      unstructuredNote: form.note.trim() || null,
    };
    if (canManageTenant.value || !isEditing.value) {
      payload.teacherIds = form.teacherIds;
      payload.teacherId = form.teacherIds[0] ?? null;
    }

    const result = isEditing.value
      ? await $fetch<AppointmentDto>(
          `/api/v1/tenants/${primaryTenant.value.tenantId}/appointments/${props.appointment!.id}`,
          {
            method: "PATCH",
            credentials: "include",
            body: payload,
            headers: props.appointment?.version ? { "If-Match": String(props.appointment.version) } : undefined,
          },
        )
      : await $fetch<AppointmentDto>(`/api/v1/tenants/${primaryTenant.value.tenantId}/appointments`, {
          method: "POST",
          credentials: "include",
          body: {
            ...payload,
            status: "confirmed",
            lessonTypeId: payload.lessonTypeId || undefined,
            teacherId: payload.teacherId || undefined,
            teacherIds: payload.teacherIds,
            resourceId: payload.resourceId || undefined,
            customerId: payload.customerId || undefined,
            appointmentPhoneRaw: payload.appointmentPhoneRaw || undefined,
            appointmentPhoneE164: payload.appointmentPhoneE164 || undefined,
            unstructuredNote: payload.unstructuredNote || undefined,
          },
        });
    saved.value = result;
    emit("saved", result);
  } catch (e: unknown) {
    error.value = apiErrorMessage(e);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  if (speechRecognitionEnabled.value) {
    setupSpeech();
  }
  loadOptions();
  void loadCallHints();
  if (speechRecognitionEnabled.value && props.startWithVoice) {
    window.setTimeout(() => toggleVoiceAssistant(), 250);
  }
});
</script>

<template>
  <div class="space-y-5">
    <UAlert
      v-if="!primaryTenant"
      color="warning"
      variant="soft"
      title="Kein Mandant verfügbar"
      description="Für echte Termine brauchst du eine aktive Mandanten-Mitgliedschaft."
    />

    <UAlert
      v-if="saved"
      color="success"
      variant="soft"
      icon="i-lucide-circle-check"
      :title="isEditing ? 'Termin aktualisiert' : 'Termin gespeichert'"
      :description="`${formatDateTime(saved.startsAt)} · ${saved.appointmentContactText || 'ohne Kontakttext'}`"
    />

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      :title="isEditing ? 'Termin konnte nicht aktualisiert werden' : 'Termin konnte nicht gespeichert werden'"
      :description="conflictType ? `${error} (${conflictType})` : error"
    />

    <UFormField required>
      <template #label>
        <span class="inline-flex items-center gap-1">
          Kontakt oder Notiz
          <FieldInfoPopover
            v-if="speechRecognitionEnabled && speechSupported"
            aria-label="Hinweis zur Diktierfunktion"
          >
            Oder nur diktieren – der Sprachassistent füllt die Felder.
          </FieldInfoPopover>
        </span>
      </template>
      <div class="relative">
        <UTextarea
          v-model="text"
          autoresize
          :rows="3"
          :placeholder="`z. B. Morgen 14 Uhr mit Luis und ${teacherLabel} Martin`"
          class="w-full min-h-[5.5rem] py-2.5 pr-12"
        />
        <UButton
          v-if="speechRecognitionEnabled && speechSupported"
          type="button"
          size="sm"
          :color="speechListening ? 'error' : 'neutral'"
          :variant="speechListening ? 'solid' : 'ghost'"
          :icon="speechListening ? 'i-lucide-mic-off' : 'i-lucide-mic'"
          :title="speechListening ? 'Aufnahme stoppen' : 'Sprachaufnahme starten'"
          class="absolute top-1 right-1"
          @click="toggleSpeech"
        />
      </div>
      <template v-if="speechListening" #help>
        <span class="flex items-center gap-2 text-xs text-primary-700 dark:text-primary-300">
          <span class="inline-block size-2 rounded-full bg-red-500 animate-pulse" />
          Aufnahme läuft… Sage „Fertig“, „Speichern“ oder „OK“ zum Stoppen.
          <span v-if="speechInterim" class="italic text-neutral-500 truncate">„{{ speechInterim }}"</span>
        </span>
      </template>
    </UFormField>

    <div class="flex flex-wrap items-center gap-1.5">
      <UButton
        v-if="speechRecognitionEnabled"
        type="button"
        size="sm"
        :color="speechListening ? 'error' : 'neutral'"
        :variant="speechListening ? 'solid' : 'soft'"
        :icon="speechListening ? 'i-lucide-mic-off' : 'i-lucide-mic'"
        :loading="parseLoading"
        @click="toggleVoiceAssistant"
      >
        {{ speechListening ? "Stoppen" : "Sprachassistent" }}
      </UButton>
      <UButton
        type="button"
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-lucide-sparkles"
        :loading="parseLoading"
        :disabled="!text.trim()"
        @click="parseFromText"
      >
        Text auswerten
      </UButton>
      <FieldInfoPopover aria-label="Hinweise zu Sprachassistent und Textauswertung">
        <p>
          Beispiel: „morgen Flug Martin, Passagier Alexandra, Telefon +49 333 6788{{
            speechRecognitionEnabled ? ". Fertig." : "."
          }}“
        </p>
        <p v-if="speechRecognitionEnabled" class="mt-2">
          Am Ende „Fertig“, „Speichern“ oder „OK“ sagen, dann stoppt die Aufnahme.
        </p>
        <p class="mt-2">
          Ohne Uhrzeit wird der nächste freie Termin mit der höchsten Priorität vorgeschlagen.
        </p>
      </FieldInfoPopover>
      <span
        v-if="speechRecognitionEnabled && !speechSupported"
        class="inline-flex items-center gap-1 text-xs text-neutral-500"
      >
        Sprache nicht verfügbar
        <FieldInfoPopover aria-label="Sprachassistent nicht verfügbar">
          Dieser Browser unterstützt die Web-Speech-API nicht. In Chrome/Edge (Desktop, Android) oder Safari (iOS
          14+) funktioniert die Diktierfunktion.
        </FieldInfoPopover>
      </span>
    </div>

    <p v-if="parseHint" class="text-sm text-neutral-600 dark:text-neutral-400">
      {{ parseHint }}
    </p>

    <div v-if="questions.length" class="space-y-2">
      <div v-for="question in questions" :key="question.id" class="space-y-1.5">
        <p class="text-sm font-medium">{{ question.prompt }}</p>
        <div class="flex flex-col gap-1.5">
          <UButton
            v-for="option in question.options"
            :key="option.value"
            block
            size="sm"
            color="neutral"
            variant="soft"
            @click="answerQuestion(question.id, option.value)"
          >
            {{ option.label }}
          </UButton>
        </div>
      </div>
    </div>

    <p v-if="speechError" class="text-sm text-amber-700 dark:text-amber-400">
      {{ speechError }}
    </p>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Datum">
        <UInput v-model="form.date" type="date" size="md" class="w-full" :ui="captureInputUi" />
      </UFormField>
      <UFormField label="Uhrzeit">
        <UInput v-model="form.time" type="time" size="md" class="w-full" :ui="captureInputUi" />
      </UFormField>
    </div>

    <div v-if="!useTypeDuration" class="space-y-1.5">
      <span class="text-sm text-neutral-600 dark:text-neutral-400">Dauer</span>
      <div class="flex flex-wrap gap-1.5">
        <UButton
          v-for="minutes in durationOptions"
          :key="minutes"
          size="xs"
          :variant="form.durationMinutes === minutes ? 'soft' : 'ghost'"
          :color="form.durationMinutes === minutes ? 'primary' : 'neutral'"
          @click="form.durationMinutes = minutes"
        >
          {{ minutes }} Min
        </UButton>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <UFormField v-if="canManageTenant || colleagueNames" class="sm:col-span-2">
        <template #label>
          <span class="inline-flex items-center gap-1">
            {{ teacherLabel }}
            <FieldInfoPopover
              v-if="canManageTenant && (options?.teachers || []).length"
              :aria-label="`Hinweis zur ${teacherLabel}-Auswahl`"
            >
              Mehrere zuordnen möglich.
            </FieldInfoPopover>
          </span>
        </template>
        <div v-if="canManageTenant" class="flex flex-wrap gap-1.5">
          <UButton
            v-for="teacher in options?.teachers || []"
            :key="teacher.id"
            type="button"
            size="xs"
            :variant="form.teacherIds.includes(teacher.id) ? 'soft' : 'ghost'"
            :color="form.teacherIds.includes(teacher.id) ? 'primary' : 'neutral'"
            @click="toggleTeacher(teacher.id)"
          >
            {{ teacher.displayName }}
          </UButton>
          <p v-if="!(options?.teachers || []).length" class="text-sm text-neutral-500">
            Keine {{ teacherLabel }} hinterlegt.
          </p>
        </div>
        <p v-else class="text-sm text-neutral-600 dark:text-neutral-400">
          Mit: {{ colleagueNames }}
        </p>
      </UFormField>

      <UFormField v-if="resourcesEnabled" label="Ressource">
        <select v-model="form.resourceId" :class="captureSelectClass">
          <option value="">Ohne Ressource</option>
          <option v-for="resource in options?.resources || []" :key="resource.id" :value="resource.id">
            {{ resource.name }} · Kapazität {{ resource.capacity }}
          </option>
        </select>
      </UFormField>

      <UFormField label="Terminart">
        <div class="flex items-center gap-2">
          <select v-model="form.lessonTypeId" :class="[captureSelectClass, 'min-w-0 flex-1']">
            <option value="">Ohne Terminart</option>
            <option v-for="lessonType in options?.lessonTypes || []" :key="lessonType.id" :value="lessonType.id">
              {{ lessonType.name }}
            </option>
          </select>
          <span
            v-if="useTypeDuration"
            class="shrink-0 text-sm font-medium tabular-nums text-neutral-600 dark:text-neutral-400"
          >
            {{ effectiveDuration }} Min
          </span>
        </div>
      </UFormField>
    </div>

    <UFormField label="Passagier / Kunde" class="w-full">
      <div class="relative">
        <UInput
          v-model="passengerName"
          size="md"
          class="w-full"
          :ui="captureInputUi"
          placeholder="Name, z. B. Alexandra"
          autocomplete="off"
        />
        <ul
          v-if="showCustomerSuggestions"
          class="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-md dark:border-neutral-700 dark:bg-neutral-900"
        >
          <li v-for="customer in customerSuggestions" :key="customer.id">
            <button
              type="button"
              class="w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              @mousedown.prevent="pickCustomerSuggestion(customer)"
            >
              {{ customer.displayName }}
            </button>
          </li>
        </ul>
      </div>
      <p v-if="willCreateCustomer" class="mt-1.5 flex items-center gap-1 text-xs text-neutral-500">
        Neuer Kunde: {{ passengerName }}
        <FieldInfoPopover aria-label="Hinweis zur Kundenerstellung">
          Beim Speichern wird der Passagier als Kunde erstellt, falls er noch nicht existiert.
        </FieldInfoPopover>
      </p>
    </UFormField>

    <UFormField class="w-full">
        <template #label>
          <span class="inline-flex items-center gap-1">
            Telefon
            <FieldInfoPopover
              v-if="showCallHintsOptInHint"
              aria-label="Hinweis zu Anruf-Vorschlägen"
            >
              Letzte Anrufe als Vorschlag: in den Einstellungen aktivieren (Android-App).
            </FieldInfoPopover>
          </span>
        </template>
        <div class="space-y-1.5">
          <div class="flex gap-2">
            <UInput
              v-model="form.phone"
              type="tel"
              size="md"
              class="min-w-0 flex-1 w-full"
              :ui="captureInputUi"
              placeholder="+43 …"
            />
            <UButton
              v-if="canPickContact"
              type="button"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-lucide-contact"
              :loading="pickingContact"
              class="shrink-0"
              title="Kontakt wählen"
              @click="pickDeviceContact"
            />
          </div>
          <div v-if="callHints.length" class="flex flex-col gap-0.5">
            <button
              v-for="hint in callHints"
              :key="`${hint.lastSeenAt}:${hint.e164 || hint.raw}`"
              type="button"
              class="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/80"
              @click="applyCallHint(hint)"
            >
              <span class="min-w-0 truncate">{{ hint.e164 || hint.raw }}</span>
              <span class="shrink-0 text-xs text-neutral-500 tabular-nums">{{ formatCallHintTime(hint.lastSeenAt) }}</span>
            </button>
          </div>
          <div v-if="canManageDeviceContact" class="flex flex-wrap items-center gap-2">
            <UButton
              v-if="canSaveDeviceContact"
              type="button"
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-user-plus"
              :loading="savingDeviceContact || checkingDeviceContact"
              @click="saveDeviceContact"
            >
              Aufs Telefon speichern
            </UButton>
            <UButton
              v-else-if="canRemoveDeviceContact"
              type="button"
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-user-minus"
              :loading="removingDeviceContact || checkingDeviceContact"
              @click="removeDeviceContact"
            >
              Vom Telefon entfernen
            </UButton>
            <span v-if="deviceContactStatusLabel || deviceContactHint" class="text-xs text-neutral-500">
              {{ deviceContactHint || deviceContactStatusLabel }}
            </span>
          </div>
        </div>
      </UFormField>

    <div class="flex items-center justify-end gap-2 pt-1">
      <UButton size="sm" variant="ghost" color="neutral" @click="emit('cancel')">Schließen</UButton>
      <UButton
        size="sm"
        color="primary"
        :disabled="!canSave || loading"
        :loading="saving"
        @click="saveAppointment"
      >
        Speichern
      </UButton>
    </div>
  </div>
</template>
