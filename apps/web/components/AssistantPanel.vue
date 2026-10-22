<script setup lang="ts">
import { computed, ref } from "vue";

const emit = defineEmits<{
  close: [];
  pickedContext: [text: string];
}>();

const { t } = useI18n();
const step = ref(0);
const answers = ref<string[]>([]);
const note = ref("");

const questions = computed(() => [
  {
    prompt: t("assistant.q1"),
    options: [t("assistant.q1a"), t("assistant.q1b")],
  },
  {
    prompt: t("assistant.q2"),
    options: [t("assistant.q2a"), t("assistant.q2b")],
  },
]);

const isDone = computed(() => step.value >= questions.value.length);

function pick(option: string) {
  answers.value[step.value] = option;
  if (step.value < questions.value.length - 1) {
    step.value += 1;
  } else {
    step.value = questions.value.length;
  }
}

function reset() {
  step.value = 0;
  answers.value = [];
  note.value = "";
}

function takeOver() {
  const lines = questions.value
    .map((q, i) => (answers.value[i] ? `${q.prompt} → ${answers.value[i]}` : null))
    .filter(Boolean) as string[];
  if (note.value.trim()) lines.push(note.value.trim());
  emit("pickedContext", lines.join("\n"));
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-neutral-600 dark:text-neutral-400">
      {{ t("assistant.intro") }}
    </p>

    <div v-if="!isDone" class="space-y-3">
      <div class="text-xs uppercase tracking-wide text-neutral-500">
        {{ t("assistant.questionOf", { current: step + 1, total: questions.length }) }}
      </div>
      <p class="font-medium">{{ questions[step].prompt }}</p>
      <div class="flex flex-col gap-2">
        <UButton
          v-for="o in questions[step].options"
          :key="o"
          size="lg"
          block
          color="neutral"
          variant="soft"
          @click="pick(o)"
        >
          {{ o }}
        </UButton>
      </div>
      <UButton variant="link" color="neutral" size="sm" @click="step = questions.length">
        {{ t("assistant.clarifyLater") }}
      </UButton>
    </div>

    <div v-else class="space-y-3">
      <UAlert
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        :title="t('assistant.contextComplete')"
        :description="t('assistant.contextCompleteHint')"
      />
      <ul class="space-y-1 text-sm">
        <li
          v-for="(q, idx) in questions"
          :key="q.prompt"
          class="flex items-start gap-2"
        >
          <UIcon name="i-lucide-corner-down-right" class="size-4 mt-0.5 text-neutral-400" />
          <span class="text-neutral-600 dark:text-neutral-400 flex-1">
            <span class="text-neutral-500">{{ q.prompt }}</span>
            <span class="ml-1 font-medium text-neutral-900 dark:text-neutral-100">
              {{ answers[idx] || "—" }}
            </span>
          </span>
        </li>
      </ul>
      <UFormField :label="t('assistant.extraNote')">
        <UTextarea v-model="note" autoresize :rows="2" :placeholder="t('assistant.extraNotePlaceholder')" />
      </UFormField>
    </div>

    <div class="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
      <UButton variant="ghost" color="neutral" @click="reset">{{ t("assistant.restart") }}</UButton>
      <UButton variant="ghost" color="neutral" @click="emit('close')">{{ t("common.close") }}</UButton>
      <UButton
        color="primary"
        icon="i-lucide-arrow-right"
        :disabled="!isDone"
        @click="takeOver"
      >
        {{ t("assistant.apply") }}
      </UButton>
    </div>
  </div>
</template>
