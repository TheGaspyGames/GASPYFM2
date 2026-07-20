import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

function extractVideoIdFromUrl(input) {
  try {
    const url = new URL(input);

    if (url.searchParams.get('v')) {
      return url.searchParams.get('v');
    }

    if (url.hostname === 'youtu.be') {
      return url.pathname.replace(/^\/+/, '').split('/')[0] || null;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const embedIndex = parts.findIndex((p) => ['embed', 'shorts', 'live', 'v'].includes(p));
    if (embedIndex >= 0 && parts[embedIndex + 1]) {
      return parts[embedIndex + 1];
    }

    return null;
  } catch {
    return null;
  }
}

export async function resolveRequestSong(input) {
  const trimmed = input.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    const videoId = extractVideoIdFromUrl(trimmed);
    if (videoId) {
      return {
        source: 'url',
        videoId,
        original: trimmed,
        title: null,
        url: trimmed
      };
    }
  }

  const args = [
    `ytsearch1:${trimmed}`,
    '--dump-json',
    '--default-search', 'ytsearch',
    '--flat-playlist',
    '--skip-download',
    '--quiet',
    '--ignore-errors',
    '--no-warnings'
  ];

  const { stdout } = await execFileAsync('yt-dlp', args);
  const firstLine = stdout.split(/\r?\n/).find(Boolean);

  if (!firstLine) {
    throw new Error('No se encontró ninguna coincidencia.');
  }

  const data = JSON.parse(firstLine);
  if (!data?.id) {
    throw new Error('yt-dlp no devolvió videoId.');
  }

  logger.info('Petición resuelta:', data.id, data.title || trimmed);

  return {
    source: 'search',
    videoId: data.id,
    original: trimmed,
    title: data.title || trimmed,
    url: data.url || data.webpage_url || `https://www.youtube.com/watch?v=${data.id}`
  };
}