# GASPYFM Radio TTS

Bot de Discord + integración con YTMDesktop que funciona como una radio online con:
- 🎵 Peticiones de canciones por Discord
- 📰 Boletines de noticias con TTS (múltiples fuentes RSS)
- 🔊 Duck de volumen automático para TTS
- 📡 Estado en tiempo real del reproductor en Discord

## Instalación

1. Copia `.env.example` a `.env` y rellena los valores.
2. Ejecuta `npm install`.
3. Activa **Companion Server** en YTMDesktop.
4. Ejecuta `npm start`.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DISCORD_BOT_TOKEN` | Token del bot de Discord |
| `DISCORD_CLIENT_ID` | Client ID de la aplicación Discord |
| `DISCORD_GUILD_ID` | ID del servidor Discord |
| `STATE_EMBED_CHANNEL_ID` | Canal donde se muestra el estado en tiempo real |
| `NEWS_FEED_URL` | URL(s) RSS para el boletín. Soporta múltiples separadas por coma |
| `NEWS_INTERVAL_MINUTES` | Minutos entre boletines automáticos (default: 30) |
| `REQUEST_COOLDOWN_SECONDS` | Cooldown entre peticiones del mismo usuario (default: 120) |

### Múltiples fuentes RSS

`NEWS_FEED_URL` acepta varias fuentes separadas por coma. Los titulares se mezclan en round-robin para variar el contenido de cada boletín:

```
NEWS_FEED_URL=https://rss.bbc.co.uk/mundo/noticias/rss.xml,https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada
```

## Comandos Discord

| Comando | Descripción |
|---|---|
| `/sonando` | Ver qué está sonando ahora |
| `/cola` | Ver las próximas peticiones |
| `/pedir cancion:[...]` | Pedir una canción (nombre o URL de YouTube) |
| `/boletin` | Forzar un boletín de noticias |

## Cambios (v0.3.0)

- **Múltiples fuentes RSS** — `NEWS_FEED_URL` acepta varias URLs separadas por coma; los titulares se intercalan en round-robin
- **Duck de volumen mejorado** — el boletín baja el volumen a 15 (más notorio que antes), los saludos a 26
- **Volumen siempre restaurado** — aunque `playAudioFile` falle, el volumen original se recupera
- **Limpieza de archivos TTS** — los `.mp3` generados se eliminan tras reproducirse para no llenar el disco
- **Duración formateada** — el embed de Discord muestra `3:45` en lugar de `225`
- **Pruning de cooldowns** — `lastByUser` se limpia cada 24h para no crecer indefinidamente
- **Re-auth optimizada** — `YtmClient` no llama a `ensureAuth()` en cada request si ya tiene token
- **Error handling en RSS** — timeout de 8s y manejo de errores HTTP, devuelve array vacío en vez de crashear
- **`.env.example`** incluido en el repo

## Dependencias necesarias

- [YTMDesktop](https://ytmdesktop.app/) con Companion Server activado
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalado y en el PATH (para resolver peticiones)
- Node.js 20+
