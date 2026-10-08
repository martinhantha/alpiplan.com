<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { avatarColor, avatarInitials } from "../utils/avatar";

interface PickerOption {
  id: string;
  displayName: string;
  color?: string | null;
}

const props = defineProps<{
  options: PickerOption[];
  label: string;
  highlightId?: string | null;
}>();

const model = defineModel<string[]>({ required: true });

const open = ref(false);
const query = ref("");
const activeIndex = ref(0);
const rootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listId = `teacher-picker-${Math.random().toString(36).slice(2, 8)}`;

const selected = computed(() =>
  model.value
    .map((id) => props.options.find((option) => option.id === id))
    .filter((option): option is PickerOption => Boolean(option)),
);

const filtered = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  if (!q) return props.options;
  return props.options.filter((option) => option.displayName.toLocaleLowerCase().includes(q));
});

watch(filtered, () => {
  activeIndex.value = 0;
});

function isSelected(id: string) {
  return model.value.includes(id);
}

function toggle(id: string) {
  model.value = isSelected(id) ? model.value.filter((value) => value !== id) : [...model.value, id];
  query.value = "";
  inputRef.value?.focus();
}

function remove(id: string) {
  model.value = model.value.filter((value) => value !== id);
}

function openList() {
  open.value = true;
  nextTick(() => inputRef.value?.focus());
}

function close() {
  open.value = false;
  query.value = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!open.value) return openList();
    activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const option = filtered.value[activeIndex.value];
    if (open.value && option) toggle(option.id);
    else openList();
  } else if (event.key === "Escape") {
    if (open.value) {
      event.stopPropagation();
      close();
    }
  } else if (event.key === "Backspace" && !query.value && model.value.length) {
    model.value = model.value.slice(0, -1);
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) close();
}

watch(open, (value) => {
  if (value) document.addEventListener("pointerdown", onDocumentPointerDown, true);
  else document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});

onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerDown, true));
</script>

<template>
  <div ref="rootRef" class="relative">
    <div
      class="flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-1.5 py-1.5 text-sm transition-colors"
      :class="
        open
          ? 'border-primary-500 ring-1 ring-primary-500/40'
          : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'
      "
      @click="openList"
    >
      <span
        v-for="option in selected"
        :key="option.id"
        class="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 py-0.5 pl-0.5 pr-1 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <span
          class="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          :style="{ backgroundColor: avatarColor(option.id, option.color) }"
        >
          {{ avatarInitials(option.displayName) }}
        </span>
        {{ option.displayName }}
        <button
          type="button"
          class="flex size-5 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          :aria-label="`${option.displayName} entfernen`"
          @click.stop="remove(option.id)"
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </span>
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        role="combobox"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-label="`${label} suchen`"
        autocomplete="off"
        class="min-w-28 flex-1 bg-transparent px-1.5 py-1 outline-none placeholder:text-neutral-400"
        :placeholder="selected.length ? 'Weitere hinzufügen…' : `${label} wählen…`"
        @focus="open = true"
        @keydown="onKeydown"
      />
      <UIcon
        name="i-lucide-chevron-down"
        class="mr-1 size-4 shrink-0 text-neutral-400 transition-transform"
        :class="open ? 'rotate-180' : ''"
      />
    </div>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-75 ease-in"
      leave-to-class="opacity-0"
    >
      <ul
        v-if="open"
        :id="listId"
        role="listbox"
        aria-multiselectable="true"
        class="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
      >
        <li
          v-for="(option, index) in filtered"
          :key="option.id"
          role="option"
          :aria-selected="isSelected(option.id)"
          class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
          :class="index === activeIndex ? 'bg-neutral-100 dark:bg-neutral-800' : ''"
          @mouseenter="activeIndex = index"
          @mousedown.prevent
          @click="toggle(option.id)"
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            :style="{ backgroundColor: avatarColor(option.id, option.color) }"
          >
            {{ avatarInitials(option.displayName) }}
          </span>
          <span class="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
            {{ option.displayName }}
            <span v-if="option.id === highlightId" class="ml-1 text-xs text-neutral-500">(ich)</span>
          </span>
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded border transition-colors"
            :class="
              isSelected(option.id)
                ? 'border-primary-500 bg-primary-500 text-white'
                : 'border-neutral-300 dark:border-neutral-600'
            "
          >
            <UIcon v-if="isSelected(option.id)" name="i-lucide-check" class="size-3.5" />
          </span>
        </li>
        <li v-if="!filtered.length" class="px-2 py-3 text-center text-sm text-neutral-500">
          Kein Treffer für „{{ query }}“
        </li>
      </ul>
    </Transition>
  </div>
</template>
