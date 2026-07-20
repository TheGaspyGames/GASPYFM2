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

const stateStore = new JsonStore('discord-state-message.json', { channelId: '', messageId: '' });

function formatDuration(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatCooldown(secs) {
  const safe = Math.max(0, Math.floor(secs || 0));
  if (safe < 60) return `${safe}s`;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
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
            .setDescription('Nombre o URL de YouTube de la canción')
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
        ),
      new SlashCommandBuilder()
        .setName('cancelar')
        .setDescription('Cancela tu última petición en cola')
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
    const queueItems = this.queue.list();
    const queueItem = queueItems[0] || null;
    const queueSize = queueItems.length;

    const embed = new EmbedBuilder()
      .setColor(0x01696f)
      .setTitle(video?.title || 'Sin reproducción')
      .setDescription(
        state?.player?.trackState === 1
          ? '🔴 Emitiendo ahora'
          : '⏸ En pausa o sin señal'
      )
      .addFields(
        { name: 'Artista', value: video?.author || 'Desconocido', inline: true },
        { name: 'Duración', value: formatDuration(video?.durationSeconds || 0), inline: true },
        {
          name: `Próxima petición${queueSize > 1 ? ` (+${queueSize - 1} más)` : ''}`,
          value: queueItem ? `${queueItem.song} · de ${queueItem.requestedBy}` : 'Sin peticiones',
          inline: false
        }
      )
      .setFooter({ text: 'GASPYFM · Sonando ahora' })
      .setTimestamp(new Date());

    const thumb =
      video?.thumbnails?.[0]?.url ||
      video?.thumbnail?.url ||
      null;

    if (thumb) {
      embed.setThumbnail(thumb);
    }

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
      next: queueItem?.song || '',
      queueSize: this.queue.size()
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

      const sent = await channel.send({ embeds: [this.buildStateEmbed()] });
      this.stateMessage = { channelId: channel.id, messageId: sent.id };
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

  async publishState(state = null, force = false) {
    if (!this.client.isReady()) return;

    const key = this.buildStateKey(state);
    if (!force && key === this.lastPublishedKey) return;

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

    await message.edit({ embeds: [this.buildStateEmbed(state)] });
    this.lastPublishedKey = key;
  }

  async start() {
    await this.registerCommands();

    this.client.once('ready', async () => {
      logger.info(`Discord conectado como ${this.client.user.tag}`);
      await this.ensureStateMessage();
      await this.publishState(null, true);
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
        const items = this.queue.list();

        if (!items.length) {
          return interaction.reply({
            content: '📭 La cola está vacía.',
            ephemeral: true
          });
        }

        const lines = items.slice(0, 10).map(
          (x, i) => `\`${i + 1}.\` **${x.song}** · pedida por ${x.requestedBy}${x.dedicateTo ? ` · para ${x.dedicateTo}` : ''}`
        );

        if (items.length > 10) {
          lines.push(`… y ${items.length - 10} más.`);
        }

        return interaction.reply({
          content: `📋 **Cola de peticiones (${items.length})**\n${lines.join('\n')}`,
          ephemeral: true
        });
      }

      if (interaction.commandName === 'boletin') {
        await interaction.reply({
          content: '📰 Boletín lanzado.',
          ephemeral: true
        });

        return this.triggerBulletin();
      }

      if (interaction.commandName === 'pedir') {
        const song = interaction.options.getString('cancion', true);
        const dedicateTo = interaction.options.getString('dedicar_a') || '';
        const messageText = interaction.options.getString('mensaje') || '';

        const remaining = this.queue.cooldownRemaining(
          interaction.user.id,
          env.requestCooldownSeconds
        );

        if (remaining > 0) {
          return interaction.reply({
            content: `⏳ Tienes que esperar **${formatCooldown(remaining)}** antes de pedir otra canción.`,
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

        const resolvedTitle =
          resolved.song ||
          resolved.title ||
          song;

        const resolvedUrl =
          resolved.url ||
          (resolved.videoId ? `https://music.youtube.com/watch?v=${resolved.videoId}` : null) ||
          (resolved.videoId ? `https://www.youtube.com/watch?v=${resolved.videoId}` : null);

        const item = this.queue.add({
          userId: interaction.user.id,
          requestedBy: interaction.user.username,
          song: resolvedTitle,
          originalInput: song,
          dedicateTo,
          message: messageText.slice(0, env.requestMaxMessageLength),
          videoId: resolved.videoId,
          sourceUrl: resolvedUrl,
          sourceType: resolved.source || 'unknown'
        });

        const position = this.queue.size();
        await this.publishState(null, true);

        return interaction.editReply({
          content: [
            `✅ Petición añadida en posición **#${position}**: **${item.song}**`,
            item.dedicateTo ? `💌 Dedicada a **${item.dedicateTo}**` : '',
            resolvedUrl ? `🔗 <${resolvedUrl}>` : ''
          ].filter(Boolean).join('\n')
        });
      }

      if (interaction.commandName === 'cancelar') {
        const items = this.queue.list();
        const ownItems = items.filter(x => x.userId === interaction.user.id);

        if (!ownItems.length) {
          return interaction.reply({
            content: '📭 No tienes ninguna petición en cola.',
            ephemeral: true
          });
        }

        const last = ownItems[ownItems.length - 1];
        this.queue.remove(last.id);
        await this.publishState(null, true);

        return interaction.reply({
          content: `🗑️ Cancelada tu petición: **${last.song}**`,
          ephemeral: true
        });
      }
    });

    await this.client.login(env.discordBotToken);
  }
}