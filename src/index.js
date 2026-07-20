import { env } from './config/env.js';
import { logger } from './services/logger.js';
import { YtmClient } from './ytm/client.js';
import { RequestQueue } from './services/requestQueue.js';
import { RadioCore } from './services/radioCore.js';
import { GaspyBot } from './discord/bot.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function playAudioFile(filePath) {
  await execFileAsync('powershell', [
    '-Command',
    `Start-Process -FilePath "${filePath}" -WindowStyle Hidden -Wait`
  ]);
}

async function main() {
  logger.info('Iniciando GASPYFM...');

  const required = [
    'discordBotToken',
    'discordClientId',
    'discordGuildId',
    'stateEmbedChannelId'
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    logger.warn('Faltan variables:', missing.join(', '));
  }

  const ytm = new YtmClient();
  const queue = new RequestQueue();

  let bot = null;

  const radio = new RadioCore({
    ytm,
    queue,
    playAudioFile,
    publishState: async (state) => {
      if (bot) await bot.publishState(state);
    }
  });

  bot = new GaspyBot({
    queue,
    getCurrentState: () => radio.getCurrentState(),
    triggerBulletin: () => radio.speakBulletin(),
    scheduleGreetingTts: (req) => radio.speakGreeting(req)
  });

  logger.info('Autenticando YTMDesktop...');
  await ytm.ensureAuth();
  logger.info('Auth YTMDesktop OK');

  logger.info('Arrancando bot de Discord...');
  await bot.start();
  logger.info('Bot de Discord listo');

  logger.info('Pidiendo estado inicial...');
  const state = await ytm.getState();
  logger.info('Estado inicial recibido');

  await radio.handleStateUpdate(state);

  logger.info('Conectando realtime...');
  await ytm.connectRealtime((nextState) => radio.handleStateUpdate(nextState));
  logger.info('Realtime conectado');

  logger.info('GASPYFM con TTS listo');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});