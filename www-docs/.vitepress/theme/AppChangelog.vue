<!--
  The Changelog section on an app's docs page. Shows the most recent few releases inline, then a
  "Read more" that opens a scrollable dialog with the full history — so the page stays short but
  every version is one click away. Data comes from the app's CHANGELOG.md, passed in by
  build-content.mjs as an escaped-JSON `releases` prop (each: { version, date, lines[] }).
-->
<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';

interface Release {
  version: string;
  date: string;
  lines: string[];
}

const props = defineProps<{ releases: string }>();

const PREVIEW = 3;

const all = computed<Release[]>(() => {
  try {
    return JSON.parse(props.releases) as Release[];
  } catch {
    return [];
  }
});
const preview = computed(() => all.value.slice(0, PREVIEW));
const hasMore = computed(() => all.value.length > preview.value.length);

const open = ref(false);
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') hide();
}
function show(): void {
  open.value = true;
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);
}
function hide(): void {
  open.value = false;
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey);
}
onUnmounted(() => {
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div class="app-changelog">
    <div v-for="r in preview" :key="r.version" class="app-changelog-entry">
      <h3 class="app-changelog-head">
        {{ r.version }} <span class="app-changelog-date">— {{ r.date }}</span>
      </h3>
      <ul>
        <li v-for="(line, i) in r.lines" :key="i">{{ line }}</li>
      </ul>
    </div>

    <button v-if="hasMore" class="app-changelog-more" type="button" @click="show">Read more</button>

    <ClientOnly>
      <Teleport to="body">
        <div v-if="open" class="app-changelog-overlay" @click.self="hide">
          <div class="app-changelog-dialog" role="dialog" aria-modal="true" aria-label="Full changelog">
            <div class="app-changelog-dialog-head">
              <strong>Changelog</strong>
              <button class="app-changelog-close" type="button" aria-label="Close" @click="hide">✕</button>
            </div>
            <div class="app-changelog-dialog-body">
              <div v-for="r in all" :key="r.version" class="app-changelog-entry">
                <h3 class="app-changelog-head">
                  {{ r.version }} <span class="app-changelog-date">— {{ r.date }}</span>
                </h3>
                <ul>
                  <li v-for="(line, i) in r.lines" :key="i">{{ line }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </ClientOnly>
  </div>
</template>

<style scoped>
.app-changelog-entry {
  margin: 0 0 1rem;
}
.app-changelog-head {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 600;
  border: 0;
  padding: 0;
}
.app-changelog-date {
  color: var(--vp-c-text-2);
  font-weight: 400;
}
.app-changelog-entry ul {
  margin: 0;
  padding-left: 1.2rem;
}
.app-changelog-more {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  cursor: pointer;
}
.app-changelog-more:hover {
  text-decoration: underline;
}

.app-changelog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.5);
}
.app-changelog-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.3);
}
.app-changelog-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--vp-c-divider);
}
.app-changelog-close {
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.app-changelog-close:hover {
  color: var(--vp-c-text-1);
}
.app-changelog-dialog-body {
  overflow-y: auto;
  padding: 1.1rem;
}
.app-changelog-dialog-body .app-changelog-entry:last-child {
  margin-bottom: 0;
}
</style>
