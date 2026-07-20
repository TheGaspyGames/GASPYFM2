import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { searchMusics } from 'node-youtube-music';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

function buildWatchUrl(videoId) {
  return videoId ? `https://music.youtube.com/watch?v=${videoId}` : null;
}

function isLikelyMusicVideo(item) {
  const title = String(item?.title || '').toLowerCase();
  const artist = String(item?.artist || '').toLowerCase();
  const album = String(item?.album || '').toLowerCase();

  return (
    title.includes('video') ||
    title.includes('official video') ||
    artist.includes('vevo') ||
    artist.includes('official') ||
    album.includes('video')
  );
}

function normalizeMusic(item, fallbackQuery) {
  return {
    videoId: item.youtubeId,
    song: item.title || fallbackQuery,
    title: item.title || fallbackQuery,
    artist: item.artist || null,
    album: item.album || null,
    duration: item.duration?.label || item.duration || null,
    url: buildWatchUrl(item.youtubeId),
    source: 'ytmusic'
  };
}

async function searchSongFirst(query) {
  try {
    const results = await searchMusics(query);
    const first = results?.find(x => x.youtubeId && x.title && !isLikelyMusicVideo(x));
    if (!first) return null;
    return normalizeMusic(first, query);
  } catch (e) {
    logger.warn(`node-youtube-music falló: ${e.message}`);
    return null;
  }
}

async function searchTopicFallback(query) {
  const args = [
    `ytsearch10:${query}`,
    '--dump-json',
    '--default-search', 'ytsearch',
    '--flat-playlist',
    '--skip-download',
    '--quiet',
    '--ignore-errors',
    '--no-warnings'
  ];

  const { stdout } = await execFileAsync('yt-dlp', args, { timeout: 15000 });

  const entries = stdout
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!entries.length) return null;

  const chosen =
    entries.find(x => typeof x.channel === 'string' && / - Topic$/i.test(x.channel)) ||
    entries.find(x => !isLikelyMusicVideo(x)) ||
    entries[0];

  return {
    videoId: chosen.id,
    song: chosen.title || query,
    title: chosen.title || query,
    artist: chosen.channel || null,
    album: null,
    duration: chosen.duration || null,
    url: buildWatchUrl(chosen.id),
    source: / - Topic$/i.test(chosen.channel || '') ? 'yt-topic' : 'youtube'
  };
}

export async function resolveRequest(query) {
  const trimmed = String(query || '').trim();

  if (!trimmed) {
    throw new Error('Consulta vacía.');
  }

  const musicResult = await searchSongFirst(trimmed);
  if (musicResult?.videoId) {
    logger.info(`Resultado musical encontrado: ${musicResult.song} (${musicResult.videoId})`);
    return musicResult;
  }

  try {
    const fallback = await searchTopicFallback(trimmed);
    if (fallback?.videoId) {
      logger.info(`Fallback encontrado: ${fallback.song} (${fallback.videoId})`);
      return fallback;
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error('yt-dlp no está instalado o no está en PATH.');
    }
    logger.warn(`Fallback yt-dlp falló: ${e.message}`);
  }

  throw new Error(`No encontré una versión musical para "${trimmed}".`);
}

export { resolveRequest as resolveRequestSong };