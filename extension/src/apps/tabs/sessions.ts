// Saved tab sessions — a named set of tabs the user stashes to reopen later.
// Stored on-device in one IndexedDB collection (surfaced in AnubisDB as "Tabs").
// Both the UI and the agent tools call these, so they can't drift.

import { dataStore } from '../../lib/dataStore.js';

const COLLECTION = 'tab-sessions';

export interface SavedTab {
  title: string;
  url: string;
  favIconUrl: string;
}
export interface Session {
  id: string;
  name: string;
  tabs: SavedTab[];
  createdAt: number;
}

export async function listSessions(): Promise<Session[]> {
  const rows = (await dataStore.list(COLLECTION)) as unknown as Session[];
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function saveSession(name: string, tabs: SavedTab[]): Promise<Session> {
  const record = { name: name.trim() || 'Untitled session', tabs, createdAt: Date.now() };
  return (await dataStore.put(COLLECTION, record)) as unknown as Session;
}

export async function deleteSession(id: string): Promise<void> {
  await dataStore.remove(COLLECTION, id);
}
