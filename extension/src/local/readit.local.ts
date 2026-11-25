// Local handler for Readit: aggregate trending articles from key-free sources,
// dedupe, cache 10 min, and rotate so
// nothing repeats until everything's been served. Sources are fetched directly
// (MV3 host_permissions bypass CORS); a failing source is just skipped.
import { register } from '../lib/localRouter.js';
import { dataStore as db } from '../lib/dataStore.js';

const TTL = 10 * 60 * 1000;
// Strip HTML tags from a source's title/description. `[^<>]` (not `[^>]`) keeps each match
// linear, and the loop re-runs until stable so a tag revealed by removing an outer one
// (e.g. `<<b>b>`) can't survive a single pass (js/incomplete-multi-character-sanitization).
const stripHtml = (s: string | null | undefined): string => {
  let out = s || '';
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<[^<>]*>/g, '');
  } while (out !== prev);
  return out.trim();
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface Article {
  title: string;
  description: string;
  url: string;
  tags: string[];
  minutes: number | null;
  source: string;
}

const article = (
  title: string,
  description: string | null | undefined,
  url: string,
  tags: string[] | null | undefined,
  minutes: number | null | undefined,
  source: string,
): Article => ({
  title: title.trim(),
  description: stripHtml(description),
  url,
  tags: (tags || []).filter(Boolean).slice(0, 3),
  minutes: minutes ?? null,
  source,
});

interface DevArticle {
  title?: string;
  description?: string;
  url?: string;
  canonical_url?: string;
  tag_list?: string[];
  reading_time_minutes?: number;
}
async function dev(): Promise<Article[]> {
  const data = await getJson<DevArticle[]>('https://dev.to/api/articles?top=7&per_page=40');
  return data
    .filter((a) => a.title && (a.url || a.canonical_url))
    .map((a) =>
      article(
        a.title ?? '',
        a.description,
        a.url || a.canonical_url || '',
        a.tag_list,
        a.reading_time_minutes,
        'DEV Community',
      ),
    );
}

interface HnHit {
  title?: string;
  url?: string;
  objectID?: string;
}
async function hackerNews(): Promise<Article[]> {
  const data = await getJson<{ hits?: HnHit[] }>('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40');
  return (data.hits || [])
    .filter((h) => h.title)
    .map((h) =>
      article(
        h.title ?? '',
        null,
        h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        [],
        null,
        'Hacker News',
      ),
    );
}

interface LobstersStory {
  title?: string;
  description?: string;
  url?: string;
  comments_url?: string;
  tags?: string[];
}
async function lobsters(): Promise<Article[]> {
  const data = await getJson<LobstersStory[]>('https://lobste.rs/hottest.json');
  return data
    .filter((s) => s.title)
    .map((s) => article(s.title ?? '', s.description, s.url || s.comments_url || '', s.tags, null, 'Lobsters'));
}

const SOURCES = [dev, hackerNews, lobsters];

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchAll(): Promise<Article[]> {
  const settled = await Promise.allSettled(SOURCES.map((source) => source()));
  const items = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const seen = new Set<string>();
  const unique: Article[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }
  return shuffle(unique);
}

async function articles(): Promise<Article[]> {
  const cache = await db.kv.get<{ at: number; items: Article[] }>('readit:cache');
  if (cache?.items?.length && Date.now() - cache.at < TTL) return cache.items;
  const items = await fetchAll();
  if (items.length) {
    await db.kv.set('readit:cache', { at: Date.now(), items });
    return items;
  }
  if (cache?.items?.length) return cache.items; // stale-but-better-than-nothing
  throw new Error("Couldn't reach any article source right now.");
}

register('GET', 'readit/next', async () => {
  const items = await articles();
  if (!items.length) throw new Error('No trending articles available.');

  // Unique rotation: never repeat until everything's been served.
  const served = new Set<string>((await db.kv.get<string[]>('readit:served')) || []);
  let pool = items.filter((a) => !served.has(a.url));
  if (!pool.length) {
    served.clear();
    pool = items;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  served.add(pick.url);
  await db.kv.set('readit:served', [...served]);
  return pick;
});
