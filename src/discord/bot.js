import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} from 'discord.js';
import { resolveRequestSong } from '../services/requestResolver.js';
import { env } from '../config/env.js';
import { JsonStore } from '../utils/jsonStore.js';
import { logger } from '../services/logger.js';

const stateStore = new JsonStore('discord-state-message.json', {
  channelId: '',
  messageId: ''
});

/** Formatea segundos a m:ss o h:mm:ss */
function formatDuration(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export class GaspyBot {
  constructor({ queue, getCurrentState, triggerBulletin, scheduleGreetingTts }) {
    this.queue = queue;
    this.getCurrentState = getCurrentState;
    this.triggerBulletin = triggerBulletin;
    this.scheduleGreetingTts = scheduleGreetingTts;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.stateChannelId = env.stateEmbedChannelId || null;
    this.stateMessage = stateStore.read();
    this.lastPublishedKey = null;
    this.stateMessagePromise = null;
  }

  commands() {
    return [
      new SlashCommandBuilder()
        .setName('sonando')
        .setDescription('Ver qué está sonando ahora mismo'),
      new SlashCommandBuilder()
        .setName('cola')
        .setDescription('Ver las próximas peticiones en cola'),
      new SlashCommandBuilder()
        .setName('boletin')
        .setDescription('Forzar un boletín de noticias ahora'),
      new SlashCommandBuilder()
        .setName('pedir')
        .setDescription('Pedir una canción')
        .addStringOption(opt =>
          opt.setName('cancion')
            .setDescription('Nombre o URL de la canción')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('dedicar_a')
            .setDescription('Dedicar la canción a alguien')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('mensaje')
            .setDescription('Mensaje para leer en antena')
            .setRequired(false)
        )
    ].map(c => c.toJSON());
  }

  async registerCommands() {
    const rest = new REST({ version: '10' }).setToken(env.discordBotToken);
    await rest.put(
      Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId),
      { body: this.commands() }
    );
  }

  buildStateEmbed(stateOverride = null) {
    const state = stateOverride || this.getCurrentState?.();
    const video = state?.video;
    const queueItem = this.queue.list()[0] || null;

    const embed = new EmbedBuilder()
      .setColor(0x01696f)
      .setTitle(video?.title || 'Sin reproducción')
      .setDescription(state?.player?.trackState === 1 ? '🔴 Emitiendo ahora' : '⏸ En pausa o sin señal')
      .addFields(
        { name: 'Artista', value: video?.author || 'Desconocido', inline: true },
        { name: 'Duración', value: formatDuration(video?.durationSeconds || 0), inline: true },
        { name: 'Próxima petición', value: queueItem ? `${queueItem.song} · de ${queueItem.requestedBy}` : 'Sin peticiones', inline: false }
      )
      .setFooter({ text: 'GASPYFM · Sonando ahora' })
      .setTimestamp(new Date());

    const thumb = video?.thumbnails?.[0]?.url;
    if (thumb) embed.setThumbnail(thumb);

    return embed;
  }

  buildStateKey(stateOverride = null) {
    const state = stateOverride || this.getCurrentState?.();
    const video = state?.video;
    const queueItem = this.queue.list()[0] || null;
    return JSON.stringify({
      id: video?.id || '',
      title: video?.title || '',
      author: video?.author || '',
      duration: video?.durationSeconds || 0,
      trackState: state?.player?.trackState || 0,
      next: queueItem?.song || ''
    });
  }

  async getStateChannel() {
    if (!this.stateChannelId) return null;

    const channel = await this.client.channels.fetch(this.stateChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      logger.warn('STATE_EMBED_CHANNEL_ID inválido o no es un canal de texto');
      return null;
    }

    return channel;
  }

  async ensureStateMessage() {
    if (this.stateMessagePromise) return this.stateMessagePromise;

    this.stateMessagePromise = (async () => {
      const channel = await this.getStateChannel();
      if (!channel) return null;

      if (this.stateMessage?.messageId) {
        const existing = await channel.messages.fetch(this.stateMessage.messageId).catch(() => null);
        if (existing) return existing;
      }

      const sent = await channel.send({
        embeds: [this.buildStateEmbed()]
      });

      this.stateMessage = {
        channelId: channel.id,
        messageId: sent.id
      };
      stateStore.write(this.stateMessage);
      logger.info(`Mensaje de estado creado: ${sent.id}`);
      return sent;
    })();

    try {
      return await this.stateMessagePromise;
    } finally {
      this.stateMessagePromise = null;
    }
  }

  async publishState(state = null) {
    if (!this.client.isReady()) return;

    const key = this.buildStateKey(state);
    if (key === this.lastPublishedKey) return;

    const channel = await this.getStateChannel();
    if (!channel) return;

    let message = null;

    if (this.stateMessage?.messageId) {
      message = await channel.messages.fetch(this.stateMessage.messageId).catch(() => null);
    }

    if (!message) {
      message = await this.ensureStateMessage();
      if (!message) return;
    }

    await message.edit({
      embeds: [this.buildStateEmbed(state)]
    });

    this.lastPublishedKey = key;
  }

  async start() {
    await this.registerCommands();

    this.client.once('ready', async () => {
      logger.info(`Discord conectado como ${this.client.user.tag}`);
      await this.ensureStateMessage();
      await this.publishState();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === 'sonando') {
        const state = this.getCurrentState();
        const title = state?.video?.title || 'Nada claro todavía';
        const author = state?.video?.author || 'Desconocido';
        const dur = formatDuration(state?.video?.durationSeconds || 0);
        return interaction.reply({
          content: `🎵 Ahora suena: **${title}** — ${author} \`${dur}\``,
          ephemeral: true
        });
      }

      if (interaction.commandName === 'cola') {
        const items = this.queue.list().slice(0, 5);
        const text = items.length
          ? items.map((x, i) => `${i + 1}. ${x.song} · ${x.requestedBy}`).join('\n')
          : 'La cola está vacía.';
        return interaction.reply({ content: text, ephemeral: true });
      }

      if (interaction.commandName === 'boletin') {
        await interaction.reply({ content: '📰 Boletín lanzado.', ephemeral: true });
        return this.triggerBulletin();
      }

      if (interaction.commandName === 'pedir') {
        const song = interaction.options.getString('cancion', true);
        const dedicateTo = interaction.options.getString('dedicar_a') || '';
        const messageText = interaction.options.getString('mensaje') || '';

        if (!this.queue.canRequest(interaction.user.id, env.requestCooldownSeconds)) {
          return interaction.reply({
            content: `⏳ Debes esperar ${env.requestCooldownSeconds} segundos entre peticiones.`,
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });

        let resolved;
        try {
          resolved = await resolveRequestSong(song);
        } catch (e) {
          return interaction.editReply({
            content: `❌ No pude resolver esa petición: ${e.message}`
          });
        }

        const item = this.queue.add({
          userId: interaction.user.id,
          requestedBy: interaction.user.username,
          song: resolved.title || song,
          originalInput: song,
          dedicateTo,
          message: messageText.slice(0, env.requestMaxMessageLength),
          videoId: resolved.videoId,
          sourceUrl: resolved.url,
          sourceType: resolved.source
        });

        await this.publishState();

        return interaction.editReply({
          content: `✅ Petición añadida: **${item.song}**${item.dedicateTo ? ` · dedicada a ${item.dedicateTo}` : ''}`
        });
      }
    });

    await this.client.login(env.discordBotToken);
  }
}
