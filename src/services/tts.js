import fs from 'fs';
import path from 'path';
import { EdgeTTS } from 'node-edge-tts';
import { logger } from './logger.js';

const ttsDir = path.resolve(process.cwd(), 'src/data/tts');
fs.mkdirSync(ttsDir, { recursive: true });

export async function synthesizeToFile(text, filename, voice = 'es-ES-ElviraNeural') {
  const filePath = path.join(ttsDir, filename);
  const tts = new EdgeTTS({
    voice,
    lang: 'es-ES',
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    timeout: 15000
  });
  await tts.ttsPromise(text, filePath);
  logger.info('TTS guardado en', filePath);
  return filePath;
}
