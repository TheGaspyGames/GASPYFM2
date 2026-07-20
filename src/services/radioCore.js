import fs from 'fs';
import { fetchNewsHeadlines } from '../news/rss.js';
import { synthesizeToFile } from './tts.js';
import { logger } from './logger.js';
import { env } from '../config/env.js';

const CMD_SET_VOLUME = 'setVolume';

/** Clamp a volume value to the valid [0, 100] range */
function clampVolume(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

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
    this.isSpeaking = false;
    this.pendingRefresh = false;
  }

  getCurrentState = () => this.currentState;

  enqueueRequest(request) {
    this.queue.push(request);
    logger.info(`Petición encolada: ${request.videoId} · ${request.song}`);
    return { queued: true, position: this.queue.length };
  }

  async safePublishState() {
    try {
      await this.publishState?.(this.currentState);
    } catch (e) {
      logger.warn(`No se pudo publicar estado en Discord: ${e.message}`);
    }
  }

  async handleStateUpdate(state) {
    const previousVideoId = this.lastVideoId;
    const currentVideoId = state?.video?.id || null;

    this.currentState = state;
    this.lastVideoId = currentVideoId;

    await this.safePublishState();

    const changedSong =
      currentVideoId &&
      previousVideoId &&
      currentVideoId !== previousVideoId;

    if (changedSong) {
      logger.info(`Cambio de canción detectado: ${previousVideoId} -> ${currentVideoId}`);
      this.pendingRefresh = true;
    }

    if (changedSong && !this.isHandlingTransition && !this.isSpeaking) {
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
    const newsDue = now - this.lastBulletinAt >= env.newsIntervalMinutes * 60 * 1000;

    if (newsDue) {
      await this.speakBulletin();
    }

    await this.playNextRequestIfAny();
  }

  async playNextRequestIfAny() {
    const next = this.queue.shift();
    if (!next?.videoId) {
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        await this.safePublishState();
      }
      return;
    }

    if (next.dedicateTo || next.message) {
      await this.speakGreeting(next);
    }

    try {
      await this.ytm.command('changeVideo', {
        videoId: next.videoId,
        playlistId: null
      });
      logger.info(`Reproduciendo petición al terminar canción actual: ${next.videoId} · ${next.song}`);
    } catch (e) {
      logger.error(`No se pudo reproducir la petición: ${e.message}`);
      return;
    }

    this.pendingRefresh = false;

    try {
      const latestState = await this.ytm.getState();
      if (latestState) {
        this.currentState = latestState;
        this.lastVideoId = latestState?.video?.id || this.lastVideoId;
      }
    } catch (e) {
      logger.warn(`No se pudo leer estado actualizado tras petición: ${e.message}`);
    }

    await this.safePublishState();
  }

  async speakBulletin() {
    const headlines = await fetchNewsHeadlines();

    const spokenText = headlines.length
      ? 'Boletín de noticias. ' +
        headlines.map((x, i) => `Titular ${i + 1}. ${x.title}`).join('. ')
      : 'No se pudieron cargar titulares ahora mismo.';

    const filePath = await synthesizeToFile(spokenText, 'bulletin.mp3');

    try {
      await this.duckAndPlayTts(filePath, 15);
      this.lastBulletinAt = Date.now();
      logger.info('Boletín emitido');
    } finally {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        logger.warn(`No se pudo eliminar boletín temporal: ${e.message}`);
      }
    }

    try {
      const latestState = await this.ytm.getState();
      if (latestState) {
        this.currentState = latestState;
      }
    } catch (e) {
      logger.warn(`No se pudo refrescar estado tras boletín: ${e.message}`);
    }

    await this.safePublishState();
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

    try {
      await this.duckAndPlayTts(filePath, 26);
    } finally {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        logger.warn(`No se pudo eliminar TTS temporal: ${e.message}`);
      }
    }
  }

  /**
   * Baja el volumen de YTMDesktop al valor `duckVolume`, reproduce el
   * archivo de audio y espera a que termine COMPLETAMENTE antes de
   * restaurar el volumen original.
   *
   * La causa del bug anterior era que playAudioFile (PowerShell
   * Start-Process) retornaba nada más lanzar el media player, por lo
   * que el finally restauraba el volumen a los ~2 segundos. Ahora
   * playAudioFile bloquea hasta que el audio acaba de verdad.
   *
   * @param {string} filePath  Ruta al archivo de audio a reproducir
   * @param {number} duckVolume  Volumen reducido durante la locución (0-100)
   */
  async duckAndPlayTts(filePath, duckVolume = 22) {
    let originalVolume = 50;
    this.isSpeaking = true;

    try {
      const state = this.currentState || await this.ytm.getState();
      originalVolume = clampVolume(
        state?.player?.volumePercent ??
        state?.player?.volume ??
        50
      );
    } catch (e) {
      logger.warn(`No se pudo leer el volumen actual: ${e.message}`);
    }

    const safeDuck = clampVolume(duckVolume);
    logger.info(`Duck de volumen: ${originalVolume} -> ${safeDuck} (reproduciendo TTS)`);

    try {
      await this.ytm.command(CMD_SET_VOLUME, safeDuck);
    } catch (e) {
      logger.warn(`No se pudo bajar el volumen: ${e.message}`);
    }

    try {
      // playAudioFile ahora bloquea hasta que el audio termina por
      // completo, por lo que el finally se ejecuta en el momento correcto.
      await this.playAudioFile(filePath);
    } catch (e) {
      logger.error(`Error reproduciendo TTS: ${e.message}`);
    } finally {
      try {
        logger.info(`Restaurando volumen a ${originalVolume}`);
        await this.ytm.command(CMD_SET_VOLUME, originalVolume);
      } catch (e) {
        logger.warn(`No se pudo restaurar el volumen: ${e.message}`);
      }
      this.isSpeaking = false;
    }
  }
}
