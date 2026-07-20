import { env } from '../config/env.js';

function stripXml(value) {
  return value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim();
}

export async function fetchNewsHeadlines() {
  if (!env.newsFeedUrl) return [];
  const res = await fetch(env.newsFeedUrl);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
  return items.map((m) => {
    const block = m[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    return { title: stripXml(title), link: stripXml(link) };
  }).filter(x => x.title);
}
