import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/(\r\n|\n|\r)/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    // Soporte para valores con '=' dentro (ej: URLs con query strings)
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

export const env = {
  discordBotToken: process.env.DISCORD_BOT_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordGuildId: process.env.DISCORD_GUILD_ID || '',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  stateEmbedChannelId: process.env.STATE_EMBED_CHANNEL_ID || '',
  ytmApiBase: process.env.YTM_API_BASE || 'http://127.0.0.1:9863/api/v1',
  ytmAppId: process.env.YTM_APP_ID || 'gaspyfmradio',
  ytmAppName: process.env.YTM_APP_NAME || 'GASPYFM Radio',
  ytmAppVersion: process.env.YTM_APP_VERSION || '0.2.0',
  // NEWS_FEED_URL soporta múltiples fuentes separadas por coma
  // Ej: https://rss.bbc.co.uk/mundo/noticias/rss.xml,https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada
  newsFeedUrl: process.env.NEWS_FEED_URL || '',
  newsIntervalMinutes: Number(process.env.NEWS_INTERVAL_MINUTES || 30),
  requestCooldownSeconds: Number(process.env.REQUEST_COOLDOWN_SECONDS || 120),
  requestMaxMessageLength: Number(process.env.REQUEST_MAX_MESSAGE_LENGTH || 180)
};
