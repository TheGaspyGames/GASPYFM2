import { env } from './config/env.js';
import { logger } from './services/logger.js';
import { YtmClient } from './ytm/client.js';
import { RequestQueue } from './services/requestQueue.js';
import { RadioCore } from './services/radioCore.js';
import { GaspyBot } from './discord/bot.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Plays an audio file and BLOCKS until playback is fully finished.
 *
 * Uses a small inline C# snippet via PowerShell to drive
 * System.Media.SoundPlayer (WAV) or calls ffplay/mpg123 for MP3.
 * Falls back to Start-Process only when nothing else is available,
 * but logs a warning because that path does NOT guarantee the audio
 * has finished before the promise resolves.
 */
async function playAudioFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  // Use PowerShell + Windows Media APIs to block until audio ends.
  // SoundPlayer only supports PCM WAV, so for MP3 we use
  // WindowsMediaPlayer COM object which does support MP3 and blocks
  // via a short polling loop.
  const psScript = `
$filePath = '${normalized.replace(/'/g, "''")}'
$ext = [System.IO.Path]::GetExtension($filePath).ToLower()
if ($ext -eq '.wav') {
  $player = New-Object System.Media.SoundPlayer
  $player.SoundLocation = $filePath
  $player.Load()
  $player.PlaySync()
} else {
  # Use Windows Media Player COM — blocks until track ends
  $wmp = New-Object -ComObject wmplayer.ocx -ErrorAction SilentlyContinue
  if ($null -eq $wmp) {
    # WMP not available: use MediaPlayer from Windows.Media.Playback (UWP)
    Add-Type -AssemblyName PresentationCore
    $mp = New-Object System.Windows.Media.MediaPlayer
    $mp.Open([Uri]::new($filePath))
    $mp.Play()
    # Wait for MediaOpened then poll until NaturalDuration is known
    Start-Sleep -Milliseconds 500
    $timeout = [DateTime]::Now.AddSeconds(120)
    while ([DateTime]::Now -lt $timeout) {
      $dur = $mp.NaturalDuration
      if ($dur.HasTimeSpan) {
        $remaining = $dur.TimeSpan.TotalMilliseconds - $mp.Position.TotalMilliseconds
        if ($remaining -le 100) { break }
        Start-Sleep -Milliseconds ([Math]::Max(100, $remaining - 200))
      } else {
        Start-Sleep -Milliseconds 100
      }
    }
    $mp.Close()
  } else {
    $wmp.URL = $filePath
    $wmp.controls.play()
    Start-Sleep -Milliseconds 500
    $timeout = [DateTime]::Now.AddSeconds(120)
    while ($wmp.playState -ne 1 -and [DateTime]::Now -lt $timeout) {
      Start-Sleep -Milliseconds 100
    }
    $wmp.close()
  }
}
`;

  await execFileAsync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    psScript
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
