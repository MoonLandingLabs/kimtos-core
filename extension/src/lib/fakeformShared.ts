// The names FakeForm's three contexts have to agree on: the in-page badge, the service worker,
// and the filler the worker injects. Ids that live in one place cannot drift out of step with
// each other, which is the failure mode when a command, a menu item and a message type are each
// spelled out wherever they happen to be used.
//
// Deliberately free of DOM and chrome imports, so every context can bundle it.

/** This app's id — the key its tier is declared under in apps/fakeform/meta.ts. */
export const FAKEFORM_APP_ID = 'fakeform';

/** What the user asked for. `form`/`field`/`all` mirror `FillScope` in lib/fakeform/fill.ts. */
export type FakeFormAction = 'form' | 'field' | 'all' | 'undo';

/** The badge asks the service worker to do something (the badge carries no filler code). */
export const FAKEFORM_RUN = 'fakeform:run';
/** The service worker tells the injected filler to do it. */
export const FAKEFORM_APPLY = 'fakeform:apply';

/** The built filler bundle the worker injects on demand. Must match ENTRIES in vite.content.config.ts. */
export const FAKEFORM_FILLER_FILE = 'fakeform-fill.js';

export interface FakeFormActionSpec {
  action: FakeFormAction;
  /** The user-facing label — one wording for the badge menu and the right-click menu. */
  label: string;
  /** The `commands` key in manifest.json. */
  command: string;
  /** The `chrome.contextMenus` item id. */
  menuId: string;
}

/**
 * The four actions, in the order they are offered. One list, so the badge menu, the context
 * menu and the keyboard commands can never disagree about what exists or what it is called.
 */
export const FAKEFORM_ACTIONS: readonly FakeFormActionSpec[] = [
  { action: 'form', label: 'Fill this form', command: 'fakeform-fill-form', menuId: 'fakeform-fill-form' },
  { action: 'field', label: 'Fill this input', command: 'fakeform-fill-input', menuId: 'fakeform-fill-input' },
  { action: 'all', label: 'Fill everything', command: 'fakeform-fill-all', menuId: 'fakeform-fill-all' },
  { action: 'undo', label: 'Undo the last fill', command: 'fakeform-undo', menuId: 'fakeform-undo' },
];

const byCommand = new Map(FAKEFORM_ACTIONS.map((a) => [a.command, a.action]));
const byMenuId = new Map(FAKEFORM_ACTIONS.map((a) => [a.menuId, a.action]));

/** The action a keyboard command names, or null when the command is not ours. */
export const actionForCommand = (command: string): FakeFormAction | null => byCommand.get(command) ?? null;

/** The action a context-menu item names, or null when the item is not ours. */
export const actionForMenuId = (menuItemId: string | number): FakeFormAction | null =>
  byMenuId.get(String(menuItemId)) ?? null;

/** Is this one of ours? Used before the click is handed to the Clipboard menu handler. */
export const isFakeFormAction = (value: unknown): value is FakeFormAction =>
  FAKEFORM_ACTIONS.some((a) => a.action === value);
