import { env } from '../config/env.js';
import { logger } from '../services/logger.js';

function stripXml(value) {
  return value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim();
}

async function fetchFromFeed(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
    return items.map((m) => {
      const block = m[1];
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
      return { title: stripXml(title), link: stripXml(link) };
    }).filter(x => x.title);
  } catch (e) {
    logger.warn(`RSS fetch falló (${url}): ${e.message}`);
    return [];
  }
}

/**
 * Obtiene titulares de múltiples fuentes RSS.
 * NEWS_FEED_URL puede ser una URL o varias separadas por coma.
 * Se mezclan y se devuelven hasta maxHeadlines sin repetir fuentes seguidas.
 */
export async function fetchNewsHeadlines(maxHeadlines = 5) {
  if (!env.newsFeedUrl) return [];

  const urls = env.newsFeedUrl
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  if (urls.length === 0) return [];

  // Fetch todas las fuentes en paralelo
  const results = await Promise.all(urls.map(fetchFromFeed));

  // Intercalar titulares de distintas fuentes (round-robin) para variedad
  const merged = [];
  const maxPerSource = Math.ceil(maxHeadlines / urls.length);

  // Tomar hasta maxPerSource de cada fuente
  const sliced = results.map(items => [...items.slice(0, maxPerSource)]);

  // Round-robin interleave
  let added = 0;
  let round = 0;
  while (added < maxHeadlines) {
    let anyLeft = false;
    for (const bucket of sliced) {
      if (round < bucket.length) {
        merged.push(bucket[round]);
        added++;
        anyLeft = true;
        if (added >= maxHeadlines) break;
      }
    }
    if (!anyLeft) break;
    round++;
  }

  return merged;
}
