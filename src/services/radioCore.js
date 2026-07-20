import { fetchNewsHeadlines } from '../news/rss.js';
import { synthesizeToFile } from './tts.js';
import { logger } from './logger.js';
import { env } from '../config/env.js';

export class RadioCore {
  constructor({ ytm, queue, playAudioFile, publishState }) {
    this.ytm = ytm;
    this.queue = queue;
    this.playAudioFile = playAudioFile;
    this.publishState = publishState;
    this.currentState = null;
    this.lastBulletinAt = 0;
    this.lastVideoId = null;
    this.isHandlingTransition = false;
  }

  getCurrentState = () => this.currentState;

  async handleStateUpdate(state) {
    const previousVideoId = this.lastVideoId;
    const currentVideoId = state?.video?.id || null;

    this.currentState = state;
    this.lastVideoId = currentVideoId;

    try {
      await this.publishState?.(this.currentState);
    } catch (e) {
      logger.warn(`No se pudo publicar estado en Discord: ${e.message}`);
    }

    const changedSong =
      currentVideoId &&
      previousVideoId &&
      currentVideoId !== previousVideoId;

    if (changedSong && !this.isHandlingTransition) {
      this.isHandlingTransition = true;
      try {
        await this.handlePostSongTransition();
      } finally {
        this.isHandlingTransition = false;
      }
    }
  }

  async handlePostSongTransition() {
    const now = Date.now();
    const newsDue =
      now - this.lastBulletinAt >= env.newsIntervalMinutes * 60 * 1000;

    if (newsDue) {
      await this.speakBulletin();
    }

    await this.playNextRequestIfAny();
  }

  async playNextRequestIfAny() {
    const next = this.queue.shift();
    if (!next?.videoId) return;

    if (next.dedicateTo || next.message) {
      await this.speakGreeting(next);
    }

    try {
      await this.ytm.command('changeVideo', {
        videoId: next.videoId
      });
      logger.info(`Reproduciendo petición: ${next.videoId} · ${next.song}`);
    } catch (e) {
      logger.error(`No se pudo reproducir la petición: ${e.message}`);
    }

    try {
      await this.publishState?.(this.currentState);
    } catch (e) {
      logger.warn(`No se pudo refrescar estado tras petición: ${e.message}`);
    }
  }

  async speakBulletin() {
    const headlines = await fetchNewsHeadlines();

    const spokenText = headlines.length
      ? 'Boletín de noticias. ' +
        headlines.map((x, i) => `Titular ${i + 1}. ${x.title}`).join('. ')
      : 'No se pudieron cargar titulares ahora mismo.';

    const filePath = await synthesizeToFile(spokenText, 'bulletin.mp3');
    await this.duckAndPlayTts(filePath, 20);
    this.lastBulletinAt = Date.now();

    logger.info('Boletín emitido');

    try {
      await this.publishState?.(this.currentState);
    } catch (e) {
      logger.warn(`No se pudo refrescar estado tras boletín: ${e.message}`);
    }
  }

  async speakGreeting(request) {
    const safeSongTitle = (request.song || 'tu canción pedida').slice(0, 120);

    const parts = [`Petición de ${request.requestedBy}.`];

    if (request.dedicateTo) {
      parts.push(`Dedicada a ${request.dedicateTo}.`);
    }

    if (request.message) {
      parts.push(`Mensaje: ${request.message}.`);
    }

    parts.push(`Y ahora suena ${safeSongTitle}.`);

    const text = parts.join(' ');
    const filePath = await synthesizeToFile(text, `greeting-${request.id}.mp3`);
    await this.duckAndPlayTts(filePath, 26);
  }

  async duckAndPlayTts(filePath, duckVolume = 22) {
    let originalVolume = 50;

    try {
      const state = this.currentState || await this.ytm.getState();
      originalVolume =
        state?.player?.volumePercent ??
        state?.player?.volume ??
        50;
    } catch (e) {
      logger.warn(`No se pudo leer el volumen actual: ${e.message}`);
    }

    try {
      await this.ytm.command('player-set-volume', duckVolume);
    } catch (e) {
      logger.warn(`No se pudo bajar el volumen: ${e.message}`);
    }

    await this.playAudioFile(filePath);

    try {
      await this.ytm.command('player-set-volume', originalVolume);
    } catch (e) {
      logger.warn(`No se pudo restaurar el volumen: ${e.message}`);
    }
  }
}