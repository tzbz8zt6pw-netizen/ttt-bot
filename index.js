require('dotenv').config();
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');
const { Pool } = require('pg');
const Parser = require('rss-parser');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const parser = new Parser();
let youtubeIntervalHandle = null;
let lastHeartbeatAt = null;

const BRAND_COLOR = 0xf35023;
const BRAND_NAME = 'TTT Markets';
const BRAND_FOOTER = 'TTT Markets • Official Alerts';
const YT_FOOTER = 'TTT Markets • YouTube Alerts';
const LOGO_URL =
  'https://tttmarkets.com/wp-content/uploads/2025/09/cropped-TTT-Logo.png';
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://tttmarkets.com';
const AUTO_POST_SHORTS =
  String(process.env.AUTO_POST_SHORTS || 'false').toLowerCase() === 'true';

const OWNER_USER_ID = process.env.OWNER_USER_ID;
const CEO_USER_ID = process.env.CEO_USER_ID;
const WUMIC_USER_ID = process.env.WUMIC_USER_ID;

const VIP_USERS = [OWNER_USER_ID, CEO_USER_ID, WUMIC_USER_ID].filter(Boolean);

const YT_REACTIONS = ['🎥', '🔥', '📈', '🚀', '💰', '👀', '📊', '⚡', '💎', '🧠', '📣', '📌'];
const ANNOUNCE_REACTIONS = ['🔥', '📢', '🚀', '💰', '👀', '📣', '🎯', '💎', '⚡', '🪙', '📊', '📌', '🚨'];
const VIP_REACTIONS = ['🔥', '📢', '🚀', '👀', '💰', '📣', '⚡', '💎', '🧠', '📊', '🎯', '🚨'];
const DEFAULT_MANAGED_REACTIONS = ['✅', '👍', '🔥', '🚀', '💰', '📈', '🧡', '💯', '👀', '🎉'];
const TEMPLATE_TYPES = new Set([
  'ANNOUNCEMENT',
  'SUBSCRIBER_DM',
  'WELCOME_CHANNEL',
  'WELCOME_DM',
  'YOUTUBE',
  'MANAGED_POST',
  'PROMOTION',
  'MAINTENANCE',
]);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const POLLING_INTERVAL_MS = Number(process.env.YOUTUBE_POLLING_INTERVAL_MS || 5 * 60 * 1000);

const DEFAULT_STATS = {
  totalAlertsRun: 0,
  totalDmSent: 0,
  totalDmFailed: 0,
  totalChannelPosts: 0,
  totalChannelFailures: 0,
  totalWelcomePosts: 0,
  totalWelcomeDMs: 0,
  totalManualAdds: 0,
  totalManualRemoves: 0,
  lastAlertAt: null,
};

const DEFAULT_WELCOME_SETTINGS = {
  enabled: true,
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
  sendChannelMessage: true,
  sendDm: true,
  autoSubscribeNewMember: false,
  channelTemplate: 'Welcome {member}.',
  dmTemplate: null,
  embedTitle: `Welcome to ${BRAND_NAME}`,
  description:
    'Welcome {member}.\n\nJoin **5000+ traders** getting:\n\n• Promo codes\n• Limited-time discounts\n• Competitions & giveaways\n• Important updates\n\n⚡ Click below to get direct alerts.',
  image: null,
  thumbnail: null,
  buttons: [
    { label: 'Visit Website', url: WEBSITE_URL },
  ],
  delayMs: 0,
  reactions: [],
};

const DEFAULT_YOUTUBE_SETTINGS = {
  enabled: true,
  youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || null,
  feedUrl: process.env.YOUTUBE_CHANNEL_ID
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${process.env.YOUTUBE_CHANNEL_ID}`
    : null,
  destinationChannelIds: [process.env.DISCORD_CHANNEL_ID].filter(Boolean),
  messageTemplate: null,
  embedTitleFormat: '{title}',
  description:
    `🎥 **New Video Dropped**\n\nA new video has just landed on the **${BRAND_NAME}** YouTube channel.\n\n🔥 [Watch now →]({link})`,
  websiteButton: { label: 'Visit Website', url: WEBSITE_URL },
  thumbnailBehavior: 'maxresdefault',
  reactionSet: YT_REACTIONS,
  pollingIntervalMs: POLLING_INTERVAL_MS,
  autoPostShorts: AUTO_POST_SHORTS,
};

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      user_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS welcomed_users (
      user_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_templates (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_announcements (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      image_url TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_announcement_channels (
      announcement_id BIGINT NOT NULL REFERENCES discord_announcements(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (announcement_id, channel_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_managed_posts (
      id BIGSERIAL PRIMARY KEY,
      internal_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      template_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_activity_logs (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT,
      source TEXT NOT NULL DEFAULT 'bot',
      discord_user_id TEXT,
      entity_type TEXT,
      entity_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_dm_campaigns (
      id BIGSERIAL PRIMARY KEY,
      announcement_id BIGINT,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      total_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_dm_deliveries (
      id BIGSERIAL PRIMARY KEY,
      campaign_id BIGINT REFERENCES discord_dm_campaigns(id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const [key, value] of Object.entries(DEFAULT_STATS)) {
    await pool.query(
      `
      INSERT INTO stats (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
      `,
      [key, value === null ? '' : String(value)]
    );
  }

  await ensureSetting('welcome', DEFAULT_WELCOME_SETTINGS);
  await ensureSetting('youtube', DEFAULT_YOUTUBE_SETTINGS);
}

async function addSubscriber(userId) {
  const result = await pool.query(
    `
    INSERT INTO subscribers (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id
    `,
    [userId]
  );

  return result.rowCount > 0;
}

async function removeSubscriber(userId) {
  const result = await pool.query(
    `DELETE FROM subscribers WHERE user_id = $1`,
    [userId]
  );
  return result.rowCount > 0;
}

async function getSubscriberCount() {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM subscribers`
  );
  return result.rows[0].count;
}

async function getSubscriberIds() {
  const result = await pool.query(
    `SELECT user_id FROM subscribers ORDER BY created_at ASC`
  );
  return result.rows.map(row => row.user_id);
}

async function markWelcomed(userId) {
  await pool.query(
    `
    INSERT INTO welcomed_users (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );
}

async function hasBeenWelcomed(userId) {
  const result = await pool.query(
    `SELECT 1 FROM welcomed_users WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rowCount > 0;
}

async function getAppState(key) {
  const result = await pool.query(
    `SELECT value FROM app_state WHERE key = $1`,
    [key]
  );
  return result.rowCount ? result.rows[0].value : null;
}

async function setAppState(key, value) {
  await pool.query(
    `
    INSERT INTO app_state (key, value)
    VALUES ($1, $2)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value
    `,
    [key, value]
  );
}

async function incrementStats(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'number') {
      await pool.query(
        `
        INSERT INTO stats (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key)
        DO UPDATE SET value = (
          COALESCE(NULLIF(stats.value, ''), '0')::bigint + EXCLUDED.value::bigint
        )::text
        `,
        [key, String(value)]
      );
    } else {
      await pool.query(
        `
        INSERT INTO stats (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value
        `,
        [key, value === null ? '' : String(value)]
      );
    }
  }
}

async function getStats() {
  const result = await pool.query(`SELECT key, value FROM stats`);
  const stats = { ...DEFAULT_STATS };

  for (const row of result.rows) {
    if (!(row.key in stats)) continue;

    if (row.key === 'lastAlertAt') {
      stats[row.key] = row.value || null;
    } else {
      stats[row.key] = Number(row.value || 0);
    }
  }

  return stats;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  return String(value).toLowerCase() === 'true';
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function normalizeDiscordId(value) {
  const id = String(value || '').trim();
  return /^\d{5,32}$/.test(id) ? id : null;
}

function parseColor(value, fallback = BRAND_COLOR) {
  if (typeof value === 'number' && value >= 0 && value <= 0xffffff) return value;
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return fallback;
  return Number.parseInt(normalized, 16);
}

function renderTemplate(template, values) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return values[key] === undefined || values[key] === null ? '' : String(values[key]);
  });
}

function validateTextLength(value, max, label) {
  if (value === undefined || value === null) return;
  if (String(value).length > max) {
    const error = new Error(`${label} exceeds Discord limit of ${max} characters`);
    error.status = 400;
    throw error;
  }
}

function validateUrl(value, label) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('URL must be HTTP or HTTPS');
    }
    return url.toString();
  } catch (error) {
    const validationError = new Error(`${label} must be a valid HTTP(S) URL`);
    validationError.status = 400;
    throw validationError;
  }
}

function validateEmbedPayload(payload) {
  validateTextLength(payload.title, 256, 'Title');
  validateTextLength(payload.message || payload.description, 4096, 'Message');
  validateTextLength(payload.footer, 2048, 'Footer');
  validateUrl(payload.imageUrl || payload.image, 'Image URL');
  validateUrl(payload.thumbnail, 'Thumbnail URL');
}

function sanitizeReactions(reactions, fallback = []) {
  if (!Array.isArray(reactions)) return fallback;
  return reactions
    .map(reaction => String(reaction || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeButtons(buttons) {
  if (!Array.isArray(buttons)) return [];

  return buttons
    .map(button => ({
      label: String(button?.label || '').trim(),
      url: button?.url ? validateUrl(button.url, 'Button URL') : null,
    }))
    .filter(button => button.label && button.url)
    .slice(0, 25);
}

function buildButtonRows(buttons) {
  const safeButtons = sanitizeButtons(buttons);
  const rows = [];

  for (let i = 0; i < safeButtons.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const button of safeButtons.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel(button.label.slice(0, 80))
          .setStyle(ButtonStyle.Link)
          .setURL(button.url)
      );
    }
    rows.push(row);
  }

  return rows.slice(0, 5);
}

function buildAllowedMentions(pingEveryone) {
  return pingEveryone ? { parse: ['everyone'] } : { parse: [] };
}

function getDefaultChannelTargets() {
  return [
    {
      enabled: true,
      id: process.env.GENERAL_CHANNEL_ID,
      label: 'general',
    },
    {
      enabled: true,
      id: process.env.ANNOUNCEMENTS_CHANNEL_ID,
      label: 'announcements',
    },
    {
      enabled: true,
      id: process.env.ACTIVE_PROMOTIONS_CHANNEL_ID,
      label: 'active-promotions',
    },
  ].filter(target => target.id);
}

function getLegacyChannelTargets(options) {
  return [
    {
      enabled: options.general,
      id: process.env.GENERAL_CHANNEL_ID,
      label: 'general',
    },
    {
      enabled: options.announcements,
      id: process.env.ANNOUNCEMENTS_CHANNEL_ID,
      label: 'announcements',
    },
    {
      enabled: options.activePromotions,
      id: process.env.ACTIVE_PROMOTIONS_CHANNEL_ID,
      label: 'active-promotions',
    },
  ];
}

async function ensureSetting(key, defaults) {
  await pool.query(
    `
    INSERT INTO discord_settings (key, value)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (key) DO NOTHING
    `,
    [key, JSON.stringify(defaults)]
  );
}

async function getSetting(key, defaults = {}) {
  const result = await pool.query(
    `SELECT value FROM discord_settings WHERE key = $1`,
    [key]
  );

  if (!result.rowCount) {
    await ensureSetting(key, defaults);
    return defaults;
  }

  return { ...defaults, ...result.rows[0].value };
}

async function updateSetting(key, defaults, patch) {
  const current = await getSetting(key, defaults);
  const next = { ...current, ...patch };

  await pool.query(
    `
    INSERT INTO discord_settings (key, value, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [key, JSON.stringify(next)]
  );

  return next;
}

async function logActivity({
  type,
  action,
  actor = null,
  source = 'bot',
  discordUserId = null,
  entityType = null,
  entityId = null,
  metadata = {},
  errorMessage = null,
}) {
  try {
    await pool.query(
      `
      INSERT INTO discord_activity_logs
        (type, action, actor, source, discord_user_id, entity_type, entity_id, metadata, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `,
      [
        type,
        action,
        actor,
        source,
        discordUserId,
        entityType,
        entityId,
        JSON.stringify(metadata || {}),
        errorMessage,
      ]
    );
  } catch (error) {
    console.log(`Activity log failed: ${error.message}`);
  }
}

async function getWelcomedCount() {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM welcomed_users`
  );
  return result.rows[0]?.count || 0;
}

async function getGuild() {
  if (!process.env.DISCORD_GUILD_ID || !client.isReady()) return null;
  return client.guilds.cache.get(process.env.DISCORD_GUILD_ID)
    || client.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
}

async function getOverviewPayload() {
  const [subscriberCount, welcomedUsersCount, stats, lastVideoId, lastYoutubePostAt, guild] =
    await Promise.all([
      getSubscriberCount(),
      getWelcomedCount(),
      getStats(),
      getAppState('lastVideoId'),
      getAppState('lastYoutubePostAt'),
      getGuild(),
    ]);

  return {
    ok: true,
    service: 'discord-bot',
    botOnline: client.isReady(),
    botStatus: client.isReady() ? 'ONLINE' : 'STARTING',
    botUsername: client.user?.tag || null,
    botId: client.user?.id || null,
    guildName: guild?.name || null,
    guildId: guild?.id || process.env.DISCORD_GUILD_ID || null,
    uptimeSeconds: Math.floor(process.uptime()),
    lastHeartbeatAt,
    memberCount: guild?.memberCount || null,
    subscriberCount,
    welcomedUsersCount,
    totalAlertsRun: stats.totalAlertsRun,
    totalDmSent: stats.totalDmSent,
    totalDmFailed: stats.totalDmFailed,
    totalChannelPosts: stats.totalChannelPosts,
    totalChannelFailures: stats.totalChannelFailures,
    totalWelcomePosts: stats.totalWelcomePosts,
    totalWelcomeDMs: stats.totalWelcomeDMs,
    totalManualAdds: stats.totalManualAdds,
    totalManualRemoves: stats.totalManualRemoves,
    lastAlertAt: stats.lastAlertAt || null,
    lastYoutubeVideoId: lastVideoId,
    lastYoutubePostAt,
    queue: {
      youtubePollingActive: Boolean(youtubeIntervalHandle),
      activeJobs: 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function listAccessibleChannels() {
  const guild = await getGuild();
  if (!guild) return [];

  await guild.channels.fetch();
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);

  return guild.channels.cache
    .map(channel => {
      const permissions = botMember ? channel.permissionsFor(botMember) : null;
      const parent = channel.parent || null;

      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentCategoryId: parent?.id || null,
        parentCategoryName: parent?.name || null,
        position: channel.rawPosition ?? channel.position ?? null,
        canView: permissions?.has(PermissionFlagsBits.ViewChannel) || false,
        canSend: permissions?.has(PermissionFlagsBits.SendMessages) || false,
        canEmbed: permissions?.has(PermissionFlagsBits.EmbedLinks) || false,
        canAttachFiles: permissions?.has(PermissionFlagsBits.AttachFiles) || false,
        canAddReactions: permissions?.has(PermissionFlagsBits.AddReactions) || false,
        canMentionEveryone: permissions?.has(PermissionFlagsBits.MentionEveryone) || false,
        managed: Boolean(channel.managed),
      };
    })
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

function groupChannelsByCategory(channels) {
  const groups = new Map();

  for (const channel of channels) {
    const key = channel.parentCategoryId || 'uncategorized';
    if (!groups.has(key)) {
      groups.set(key, {
        categoryId: channel.parentCategoryId,
        categoryName: channel.parentCategoryName || 'Uncategorized',
        channels: [],
      });
    }

    groups.get(key).channels.push(channel);
  }

  return Array.from(groups.values());
}

async function listSubscribers({ page = 1, limit = 50, search = '' }) {
  const safePage = parsePositiveInt(page, 1);
  const safeLimit = parsePositiveInt(limit, 50, 200);
  const offset = (safePage - 1) * safeLimit;
  const like = `%${String(search || '').trim()}%`;
  const params = search ? [like, safeLimit, offset] : [safeLimit, offset];

  const rowsQuery = search
    ? `
      SELECT user_id, created_at
      FROM subscribers
      WHERE user_id ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `
    : `
      SELECT user_id, created_at
      FROM subscribers
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `;

  const countQuery = search
    ? `SELECT COUNT(*)::int AS count FROM subscribers WHERE user_id ILIKE $1`
    : `SELECT COUNT(*)::int AS count FROM subscribers`;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(rowsQuery, params),
    pool.query(countQuery, search ? [like] : []),
  ]);

  return {
    page: safePage,
    limit: safeLimit,
    total: countResult.rows[0]?.count || 0,
    subscribers: rowsResult.rows.map(row => ({
      discordUserId: row.user_id,
      createdAt: row.created_at,
    })),
  };
}

async function getSubscriber(discordUserId) {
  const result = await pool.query(
    `SELECT user_id, created_at FROM subscribers WHERE user_id = $1`,
    [discordUserId]
  );

  if (!result.rowCount) return null;

  return {
    discordUserId: result.rows[0].user_id,
    createdAt: result.rows[0].created_at,
  };
}

function buildPayloadEmbed(payload) {
  validateEmbedPayload(payload);

  const embed = new EmbedBuilder()
    .setColor(parseColor(payload.embedColor || payload.color, BRAND_COLOR))
    .setTitle(String(payload.title || BRAND_NAME).slice(0, 256))
    .setDescription(String(payload.message || payload.description || '').slice(0, 4096))
    .setFooter({ text: String(payload.footer || BRAND_FOOTER).slice(0, 2048), iconURL: LOGO_URL })
    .setTimestamp();

  const imageUrl = payload.imageUrl || payload.image;
  if (imageUrl) embed.setImage(imageUrl);
  if (payload.thumbnail) embed.setThumbnail(payload.thumbnail);
  if (payload.url) embed.setURL(validateUrl(payload.url, 'Embed URL'));

  if (Array.isArray(payload.fields)) {
    const fields = payload.fields
      .map(field => ({
        name: String(field?.name || '').slice(0, 256),
        value: String(field?.value || '').slice(0, 1024),
        inline: Boolean(field?.inline),
      }))
      .filter(field => field.name && field.value)
      .slice(0, 25);

    if (fields.length) embed.addFields(fields);
  }

  return embed;
}

function buildMessageOptionsFromPayload(payload) {
  const components = payload.components || buildButtonRows(
    payload.buttons?.length ? payload.buttons : [{ label: 'Visit Website', url: WEBSITE_URL }]
  );

  return {
    content: payload.pingEveryone ? '@everyone' : (payload.content || ''),
    embeds: [payload.embed || buildPayloadEmbed(payload)],
    components,
    allowedMentions: buildAllowedMentions(payload.pingEveryone),
  };
}

function getYoutubeThumbnail(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

function looksLikeShort(item) {
  const title = String(item?.title || '').toLowerCase();
  const link = String(item?.link || '').toLowerCase();

  return (
    title.includes('#shorts') ||
    title.startsWith('shorts') ||
    title.includes(' short ') ||
    link.includes('/shorts/')
  );
}

function buildWebsiteButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Visit Website')
      .setStyle(ButtonStyle.Link)
      .setURL(WEBSITE_URL)
  );
}

function buildSubscriptionButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('subscribe_alerts')
      .setLabel('🔥 Get Early Access')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('unsubscribe_alerts')
      .setLabel('Stop Alerts')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildGenericEmbed({ title, message, imageUrl }) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(title)
    .setDescription(message)
    .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
    .setTimestamp();

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildYoutubeEmbed(video) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(video.title)
    .setURL(video.link)
    .setDescription(
      `🎥 **New Video Dropped**\n\nA new video has just landed on the **${BRAND_NAME}** YouTube channel.\n\n🔥 [Watch now →](${video.link})`
    )
    .setImage(video.thumbnail)
    .setFooter({ text: YT_FOOTER, iconURL: LOGO_URL })
    .setTimestamp();
}

function buildWelcomeEmbed(member, settings = DEFAULT_WELCOME_SETTINGS) {
  const values = {
    member: `${member}`,
    username: member.user?.username || member.displayName || 'there',
    brandName: BRAND_NAME,
    websiteUrl: WEBSITE_URL,
  };
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(renderTemplate(settings.embedTitle || `Welcome to ${BRAND_NAME}`, values))
    .setDescription(renderTemplate(settings.description || DEFAULT_WELCOME_SETTINGS.description, values))
    .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
    .setTimestamp();

  if (settings.image) embed.setImage(settings.image);
  if (settings.thumbnail) embed.setThumbnail(settings.thumbnail);

  return embed;
}

async function addReactions(message, reactions) {
  for (const emoji of reactions) {
    try {
      await message.react(emoji);
      await sleep(300);
    } catch (error) {
      console.log(`Failed to react with ${emoji}: ${error.message}`);
    }
  }
}

async function fetchTextChannel(channelId) {
  const channel = await client.channels.fetch(channelId);

  if (!channel || channel.type !== ChannelType.GuildText) {
    const error = new Error('Channel not found or is not a text channel');
    error.status = 404;
    throw error;
  }

  const permissions = client.user ? channel.permissionsFor(client.user) : null;
  if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) {
    const error = new Error('Bot cannot view this channel');
    error.status = 403;
    throw error;
  }
  if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
    const error = new Error('Bot cannot send messages in this channel');
    error.status = 403;
    throw error;
  }

  return channel;
}

async function sendToChannelId(channelId, payload, reactions = []) {
  const channel = await fetchTextChannel(channelId);
  const msg = await channel.send(buildMessageOptionsFromPayload(payload));
  await addReactions(msg, sanitizeReactions(reactions));
  return msg;
}

async function editOrCreateManagedMessage({ channelId, messageId, payload, reactions }) {
  const channel = await fetchTextChannel(channelId);
  const messageOptions = buildMessageOptionsFromPayload(payload);
  let message = null;

  if (messageId) {
    try {
      message = await channel.messages.fetch(messageId);
      await message.edit(messageOptions);
    } catch (error) {
      if (error.code !== 10008) {
        throw error;
      }
    }
  }

  if (!message) {
    message = await channel.send(messageOptions);
  }

  await addReactions(message, sanitizeReactions(reactions, DEFAULT_MANAGED_REACTIONS));
  return message;
}

const commands = [
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement to subscribers and/or selected channels')
    .addStringOption(option =>
      option.setName('title').setDescription('Announcement title').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('Announcement message').setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('send_dm').setDescription('Send DM to subscribed users').setRequired(true)
    )
    .addAttachmentOption(option =>
      option.setName('image').setDescription('Upload an image (optional)').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('general').setDescription('Post in #general').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('announcements').setDescription('Post in #announcements').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('active_promotions').setDescription('Post in #active-promotions').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('ping_everyone').setDescription('Ping @everyone in selected channels').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('testyt')
    .setDescription('Send a test YouTube alert')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setupalerts')
    .setDescription('Post the DM subscription panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('subscriberstats')
    .setDescription('View current subscriber stats')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('listsubscribers')
    .setDescription('List subscribed user IDs')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('addsubscriber')
    .setDescription('Manually add a subscriber who asked to be added')
    .addUserOption(option =>
      option.setName('user').setDescription('User to add').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('removesubscriber')
    .setDescription('Manually remove a subscriber')
    .addUserOption(option =>
      option.setName('user').setDescription('User to remove').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('sendalert')
    .setDescription('Send an alert to subscribers and/or selected channels')
    .addStringOption(option =>
      option.setName('title').setDescription('Alert title').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('Alert body').setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('send_dm').setDescription('Send DM to subscribed users').setRequired(true)
    )
    .addAttachmentOption(option =>
      option.setName('image').setDescription('Upload an image (optional)').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('general').setDescription('Post in #general').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('announcements').setDescription('Post in #announcements').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('active_promotions').setDescription('Post in #active-promotions').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('ping_everyone').setDescription('Ping @everyone in selected channels').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_APP_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

async function postYoutubeVideo(video) {
  const settings = await getSetting('youtube', DEFAULT_YOUTUBE_SETTINGS);
  const channelIds = Array.isArray(settings.destinationChannelIds) && settings.destinationChannelIds.length
    ? settings.destinationChannelIds
    : [process.env.DISCORD_CHANNEL_ID].filter(Boolean);
  const embed = buildYoutubeEmbed(video);
  let postedCount = 0;
  let failedCount = 0;

  for (const channelId of channelIds) {
    try {
      const msg = await sendToChannelId(
        channelId,
        {
          embed,
          components: [buildWebsiteButtonRow()],
          pingEveryone: false,
        },
        settings.reactionSet || YT_REACTIONS
      );
      postedCount += 1;
      await logActivity({
        type: 'youtube',
        action: 'posted',
        source: 'bot',
        entityType: 'youtube_video',
        entityId: video.id || null,
        metadata: { channelId, messageId: msg.id, title: video.title, link: video.link },
      });
    } catch (error) {
      failedCount += 1;
      console.log(`Failed YouTube post to ${channelId}: ${error.message}`);
      await logActivity({
        type: 'youtube',
        action: 'post_failed',
        source: 'bot',
        entityType: 'youtube_video',
        entityId: video.id || null,
        metadata: { channelId, title: video.title, link: video.link },
        errorMessage: error.message,
      });
    }
  }

  await incrementStats({
    totalChannelPosts: postedCount,
    totalChannelFailures: failedCount,
  });
  await setAppState('lastYoutubePostAt', new Date().toISOString());
}

async function checkYoutubeFeed() {
  try {
    const settings = await getSetting('youtube', DEFAULT_YOUTUBE_SETTINGS);
    if (!settings.enabled) return;

    const feedUrl = settings.feedUrl
      || `https://www.youtube.com/feeds/videos.xml?channel_id=${settings.youtubeChannelId || process.env.YOUTUBE_CHANNEL_ID}`;
    const feed = await parser.parseURL(feedUrl);

    if (!feed.items || feed.items.length === 0) return;

    const recentItems = feed.items.slice(0, 10);
    const lastVideoId = await getAppState('lastVideoId');

    if (!lastVideoId) {
      const newestVideoId = recentItems[0]?.id?.split(':').pop();
      if (newestVideoId) {
        await setAppState('lastVideoId', newestVideoId);
        console.log('Initial YouTube video saved, no alert sent.');
      }
      return;
    }

    const newVideos = [];

    for (const item of recentItems) {
      const videoId = item.id?.split(':').pop();
      if (!videoId) continue;

      if (videoId === lastVideoId) {
        break;
      }

      if (!settings.autoPostShorts && looksLikeShort(item)) {
        continue;
      }

      newVideos.push({
        id: videoId,
        title: item.title,
        link: item.link,
      });
    }

    if (newVideos.length === 0) return;

    newVideos.reverse();

    for (const video of newVideos) {
      await postYoutubeVideo({
        id: video.id,
        title: video.title,
        link: video.link,
        thumbnail: getYoutubeThumbnail(video.id),
      });

      await sleep(1500);
    }

    const newestVideoId = recentItems[0]?.id?.split(':').pop();
    if (newestVideoId) {
      await setAppState('lastVideoId', newestVideoId);
    }

    console.log(`Posted ${newVideos.length} new YouTube video(s).`);
  } catch (error) {
    console.error('YouTube check failed:', error.message);
  }
}

async function sendEmbedToSubscribers(embed) {
  const subscribers = await getSubscriberIds();
  const campaignResult = await pool.query(
    `
    INSERT INTO discord_dm_campaigns (name, status, total_count)
    VALUES ($1, $2, $3)
    RETURNING id
    `,
    ['Broadcast DM', 'running', subscribers.length]
  );
  const campaignId = campaignResult.rows[0]?.id || null;

  let successCount = 0;
  let failCount = 0;

  for (const userId of subscribers) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [embed],
        components: [buildWebsiteButtonRow()],
      });
      successCount += 1;
      if (campaignId) {
        await pool.query(
          `
          INSERT INTO discord_dm_deliveries (campaign_id, discord_user_id, status)
          VALUES ($1, $2, $3)
          `,
          [campaignId, userId, 'sent']
        );
      }
    } catch (error) {
      failCount += 1;
      console.log(`Failed DM to ${userId}: ${error.message}`);
      if (campaignId) {
        await pool.query(
          `
          INSERT INTO discord_dm_deliveries (campaign_id, discord_user_id, status, error_message)
          VALUES ($1, $2, $3, $4)
          `,
          [campaignId, userId, 'failed', error.message]
        );
      }
    }

    await sleep(1200);
  }

  await incrementStats({
    totalDmSent: successCount,
    totalDmFailed: failCount,
  });

  if (campaignId) {
    await pool.query(
      `
      UPDATE discord_dm_campaigns
      SET status = $1,
          success_count = $2,
          failure_count = $3,
          updated_at = NOW(),
          completed_at = NOW()
      WHERE id = $4
      `,
      ['completed', successCount, failCount, campaignId]
    );
  }

  return {
    total: subscribers.length,
    successCount,
    failCount,
    campaignId,
  };
}

async function sendEmbedToSelectedChannels(embed, options) {
  const channelTargets = Array.isArray(options.channelIds)
    ? options.channelIds.map(id => ({ enabled: true, id, label: id }))
    : getLegacyChannelTargets(options);

  let postedCount = 0;
  let failedCount = 0;
  const posts = [];

  for (const target of channelTargets) {
    if (!target.enabled) continue;
    if (!target.id) {
      failedCount += 1;
      console.log(`Missing channel ID for ${target.label}`);
      continue;
    }

    try {
      const msg = await sendToChannelId(
        target.id,
        {
          embed,
          components: options.components || [buildWebsiteButtonRow()],
          pingEveryone: options.pingEveryone,
        },
        options.reactions || ANNOUNCE_REACTIONS
      );
      postedCount += 1;
      posts.push({ channelId: target.id, messageId: msg.id });
    } catch (error) {
      failedCount += 1;
      console.log(`Failed to post in ${target.label}: ${error.message}`);
    }
  }

  await incrementStats({
    totalChannelPosts: postedCount,
    totalChannelFailures: failedCount,
  });

  return { postedCount, failedCount, posts };
}

async function runBroadcast({
  embed,
  sendDM,
  general,
  announcements,
  activePromotions,
  pingEveryone,
  channelIds,
  components,
  reactions,
}) {
  let dmResult = {
    total: 0,
    successCount: 0,
    failCount: 0,
  };

  if (sendDM) {
    dmResult = await sendEmbedToSubscribers(embed);
  }

  const channelResult = await sendEmbedToSelectedChannels(embed, {
    general,
    announcements,
    activePromotions,
    pingEveryone,
    channelIds,
    components,
    reactions,
  });

  await incrementStats({
    totalAlertsRun: 1,
    lastAlertAt: new Date().toISOString(),
  });

  return { dmResult, channelResult };
}

async function sendWelcomeFlow(member) {
  if (await hasBeenWelcomed(member.id)) {
    return;
  }

  const settings = await getSetting('welcome', DEFAULT_WELCOME_SETTINGS);
  if (!settings.enabled) return;

  if (settings.delayMs) {
    await sleep(Math.min(Number(settings.delayMs) || 0, 30000));
  }

  const embed = buildWelcomeEmbed(member, settings);
  const extraButtonRows = buildButtonRows(settings.buttons || []).slice(0, 4);
  const components = [buildSubscriptionButtons(), ...(extraButtonRows.length ? extraButtonRows : [buildWebsiteButtonRow()])];

  try {
    const welcomeChannelId = settings.welcomeChannelId || process.env.WELCOME_CHANNEL_ID;
    if (settings.sendChannelMessage && welcomeChannelId) {
      const channel = await client.channels.fetch(welcomeChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({
          content: renderTemplate(settings.channelTemplate || 'Welcome {member}.', {
            member: `${member}`,
            username: member.user?.username || member.displayName || 'there',
            brandName: BRAND_NAME,
          }),
          embeds: [embed],
          components,
          allowedMentions: { users: [member.id], parse: [] },
        });
        await incrementStats({ totalWelcomePosts: 1 });
        await logActivity({
          type: 'welcome',
          action: 'channel_post',
          source: 'bot',
          discordUserId: member.id,
          metadata: { channelId: welcomeChannelId },
        });
      }
    }
  } catch (error) {
    console.log(`Failed welcome channel post for ${member.id}: ${error.message}`);
  }

  if (settings.sendDm) {
    try {
      await member.send({
        embeds: [embed],
        components,
      });
      await incrementStats({ totalWelcomeDMs: 1 });
      await logActivity({
        type: 'welcome',
        action: 'dm_sent',
        source: 'bot',
        discordUserId: member.id,
      });
    } catch (error) {
      console.log(`Failed welcome DM for ${member.id}: ${error.message}`);
      await logActivity({
        type: 'welcome',
        action: 'dm_failed',
        source: 'bot',
        discordUserId: member.id,
        errorMessage: error.message,
      });
    }
  }

  if (settings.autoSubscribeNewMember) {
    const added = await addSubscriber(member.id);
    if (added) {
      await logActivity({
        type: 'subscriber',
        action: 'auto_add',
        source: 'bot',
        discordUserId: member.id,
      });
    }
  }

  await markWelcomed(member.id);
}

client.once('clientReady', async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  lastHeartbeatAt = new Date().toISOString();
  await checkYoutubeFeed();
  youtubeIntervalHandle = setInterval(async () => {
    lastHeartbeatAt = new Date().toISOString();
    const settings = await getSetting('youtube', DEFAULT_YOUTUBE_SETTINGS);
    await checkYoutubeFeed();

    if (settings.pollingIntervalMs && settings.pollingIntervalMs !== POLLING_INTERVAL_MS) {
      clearInterval(youtubeIntervalHandle);
      youtubeIntervalHandle = setInterval(checkYoutubeFeed, settings.pollingIntervalMs);
    }
  }, POLLING_INTERVAL_MS);
});

client.on('guildMemberAdd', async member => {
  if (member.user.bot) return;
  if (member.pending) return;
  await sendWelcomeFlow(member);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (newMember.user.bot) return;

  if (oldMember.pending && !newMember.pending) {
    await sendWelcomeFlow(newMember);
  }
});

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requireCrmAuth(req, res, next) {
  if (!process.env.CRM_SHARED_SECRET) {
    return res.status(500).json({
      ok: false,
      error: 'CRM_SHARED_SECRET is not configured',
    });
  }

  const authHeader = req.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const providedSecret = req.get('x-crm-secret') || bearerToken || req.query.secret;

  if (providedSecret !== process.env.CRM_SHARED_SECRET) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
    });
  }

  return next();
}

function sendApiError(error, req, res, next) {
  console.error(`${req.method} ${req.path} failed:`, error);
  res.status(error.status || 500).json({
    ok: false,
    error: error.status ? error.message : 'Server error',
  });
}

function requireDiscordId(value, label = 'Discord user ID') {
  const id = normalizeDiscordId(value);
  if (!id) {
    const error = new Error(`${label} is invalid`);
    error.status = 400;
    throw error;
  }
  return id;
}

function getActor(req) {
  return req.get('x-crm-actor') || req.get('x-user-email') || 'crm';
}

function normalizeAnnouncementPayload(body) {
  const channelIds = Array.isArray(body.channelIds)
    ? body.channelIds.map(id => normalizeDiscordId(id)).filter(Boolean)
    : [];
  const payload = {
    title: String(body.title || '').trim(),
    message: String(body.message || body.description || '').trim(),
    imageUrl: body.imageUrl || null,
    channelIds,
    sendDm: toBoolean(body.sendToSubscribersByDm ?? body.sendDm, false),
    pingEveryone: toBoolean(body.pingEveryone, false),
    buttons: sanitizeButtons(body.buttons || []),
    embedColor: body.embedColor || body.color || BRAND_COLOR,
    footer: body.footer || BRAND_FOOTER,
    reactions: sanitizeReactions(body.reactions, ANNOUNCE_REACTIONS),
    saveAsDraft: toBoolean(body.saveAsDraft, false),
    sendImmediately: toBoolean(body.sendImmediately, false),
  };

  if (!payload.title) {
    const error = new Error('Title is required');
    error.status = 400;
    throw error;
  }
  if (!payload.message) {
    const error = new Error('Message is required');
    error.status = 400;
    throw error;
  }

  validateEmbedPayload(payload);
  return payload;
}

async function getAnnouncement(id) {
  const result = await pool.query(
    `
    SELECT a.*,
      COALESCE(json_agg(ac.channel_id) FILTER (WHERE ac.channel_id IS NOT NULL), '[]') AS channel_ids
    FROM discord_announcements a
    LEFT JOIN discord_announcement_channels ac ON ac.announcement_id = a.id
    WHERE a.id = $1
    GROUP BY a.id
    `,
    [id]
  );

  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    imageUrl: row.image_url,
    payload: row.payload,
    channelIds: row.channel_ids || [],
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

async function sendAnnouncementById(id, req) {
  const announcement = await getAnnouncement(id);
  if (!announcement) {
    const error = new Error('Announcement not found');
    error.status = 404;
    throw error;
  }

  const payload = {
    ...announcement.payload,
    title: announcement.title,
    message: announcement.message,
    imageUrl: announcement.imageUrl,
    channelIds: announcement.channelIds,
  };
  const embed = buildPayloadEmbed(payload);
  const buttonRows = buildButtonRows(payload.buttons || []);

  try {
    const result = await runBroadcast({
      embed,
      sendDM: Boolean(payload.sendDm),
      channelIds: payload.channelIds,
      pingEveryone: Boolean(payload.pingEveryone),
      components: buttonRows.length ? buttonRows : undefined,
      reactions: payload.reactions || ANNOUNCE_REACTIONS,
    });

    await pool.query(
      `
      UPDATE discord_announcements
      SET status = 'sent', sent_at = NOW(), updated_at = NOW(), last_error = NULL
      WHERE id = $1
      `,
      [id]
    );

    await logActivity({
      type: 'announcement',
      action: 'sent',
      actor: req ? getActor(req) : null,
      source: req ? 'crm_api' : 'bot',
      entityType: 'announcement',
      entityId: String(id),
      metadata: result,
    });

    return result;
  } catch (error) {
    await pool.query(
      `
      UPDATE discord_announcements
      SET status = 'error', updated_at = NOW(), last_error = $2
      WHERE id = $1
      `,
      [id, error.message]
    );
    await logActivity({
      type: 'announcement',
      action: 'send_failed',
      actor: req ? getActor(req) : null,
      source: req ? 'crm_api' : 'bot',
      entityType: 'announcement',
      entityId: String(id),
      errorMessage: error.message,
    });
    throw error;
  }
}

async function createAnnouncement(body, req) {
  const payload = normalizeAnnouncementPayload(body);
  const status = payload.sendImmediately && !payload.saveAsDraft ? 'queued' : 'draft';

  const result = await pool.query(
    `
    INSERT INTO discord_announcements (title, message, image_url, payload, status)
    VALUES ($1, $2, $3, $4::jsonb, $5)
    RETURNING id
    `,
    [payload.title, payload.message, payload.imageUrl, JSON.stringify(payload), status]
  );
  const id = result.rows[0].id;

  for (const channelId of payload.channelIds) {
    await pool.query(
      `
      INSERT INTO discord_announcement_channels (announcement_id, channel_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [id, channelId]
    );
  }

  await logActivity({
    type: 'announcement',
    action: 'created',
    actor: getActor(req),
    source: 'crm_api',
    entityType: 'announcement',
    entityId: String(id),
    metadata: { status },
  });

  let sendResult = null;
  if (payload.sendImmediately && !payload.saveAsDraft) {
    sendResult = await sendAnnouncementById(id, req);
  }

  return {
    announcement: await getAnnouncement(id),
    sendResult,
  };
}

function normalizeManagedPayload(body) {
  const channelId = requireDiscordId(body.channelId || body.discordChannelId, 'Discord channel ID');
  const payload = {
    internalName: String(body.internalName || body.name || '').trim(),
    channelId,
    messageId: body.messageId || body.discordMessageId || null,
    status: body.status || 'draft',
    displayOrder: Number.parseInt(body.displayOrder || 0, 10) || 0,
    templateId: body.templateId || null,
    title: body.title || body.payload?.title || body.internalName || 'TTT Markets',
    description: body.description || body.payload?.description || '',
    content: body.content || body.payload?.content || '',
    fields: body.fields || body.payload?.fields || [],
    imageUrl: body.imageUrl || body.image || body.payload?.imageUrl || null,
    thumbnail: body.thumbnail || body.payload?.thumbnail || null,
    footer: body.footer || body.payload?.footer || BRAND_FOOTER,
    embedColor: body.embedColor || body.color || body.payload?.embedColor || BRAND_COLOR,
    buttons: sanitizeButtons(body.buttons || body.payload?.buttons || []),
    contentBlocks: body.contentBlocks || body.blocks || body.payload?.contentBlocks || [],
    reactions: sanitizeReactions(body.reactions || body.payload?.reactions, DEFAULT_MANAGED_REACTIONS).slice(0, 10),
  };

  if (!payload.internalName) {
    const error = new Error('Internal name is required');
    error.status = 400;
    throw error;
  }

  validateEmbedPayload({
    title: payload.title,
    message: payload.description,
    imageUrl: payload.imageUrl,
    thumbnail: payload.thumbnail,
    footer: payload.footer,
  });

  return payload;
}

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const isVIP = VIP_USERS.includes(message.author.id);

  if (isVIP && message.mentions.everyone) {
    await addReactions(message, VIP_REACTIONS);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const userId = interaction.user.id;

    if (interaction.customId === 'subscribe_alerts') {
      const added = await addSubscriber(userId);

      await interaction.reply({
        content: added
          ? '✅ You’re in. Check your DMs 👀'
          : 'ℹ️ You are already subscribed to TTT promo alerts.',
        ephemeral: true,
      });

      if (added) {
        try {
          const user = await client.users.fetch(userId);

          const embed = new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('🚀 Welcome to TTT Markets')
            .setDescription(
              `You’re now getting access to everything most traders miss.\n\n` +
                `Here’s what separates TTT from most prop firms:\n\n` +
                `• Up to 90% profit split\n` +
                `• Low 5% profit targets (built for consistency)\n` +
                `• Clear, rule-based structure — no hidden tricks\n` +
                `• Fast payouts & scalable funding up to $1M\n\n` +
                `We’ve built TTT for traders who want structure, not luck.\n\n` +
                `👉 Get started:\n${WEBSITE_URL}\n\n` +
                `—\n\n` +
                `Need help or have questions?\n\n` +
                `💬 WhatsApp (fastest):\nhttps://wa.me/message/CCZYYQBWUHWSB1\n\n` +
                `📩 Support:\nsupport@tttmarkets.com\n\n` +
                `💳 Billing:\nBilling@tttmarkets.com\n\n` +
                `🤝 Partnerships:\nPartnerships@tttmarkets.com\n\n` +
                `Or open a ticket inside Discord.\n\n` +
                `We’ll point you in the right direction.`
            )
            .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('Visit Website')
              .setStyle(ButtonStyle.Link)
              .setURL(WEBSITE_URL),
            new ButtonBuilder()
              .setLabel('WhatsApp Support')
              .setStyle(ButtonStyle.Link)
              .setURL('https://wa.me/message/CCZYYQBWUHWSB1')
          );

          await user.send({
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.log(`Failed to send subscriber welcome DM to ${userId}: ${error.message}`);
        }
      }

      return;
    }

    if (interaction.customId === 'unsubscribe_alerts') {
      const removed = await removeSubscriber(userId);

      await interaction.reply({
        content: removed
          ? '✅ You have been unsubscribed from TTT promo alerts.'
          : 'ℹ️ You were not currently subscribed.',
        ephemeral: true,
      });
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'announce') {
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const sendDM = interaction.options.getBoolean('send_dm', true);
    const image = interaction.options.getAttachment('image');
    const postGeneral = interaction.options.getBoolean('general') || false;
    const postAnnouncements = interaction.options.getBoolean('announcements') || false;
    const postActivePromotions = interaction.options.getBoolean('active_promotions') || false;
    const pingEveryone = interaction.options.getBoolean('ping_everyone') || false;

    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: 'Sending announcement...',
    });

    const embed = buildGenericEmbed({
      title,
      message,
      imageUrl: image?.url || null,
    });

    const result = await runBroadcast({
      embed,
      sendDM,
      general: postGeneral,
      announcements: postAnnouncements,
      activePromotions: postActivePromotions,
      pingEveryone,
    });

    await interaction.followUp({
      content:
        `Announcement complete.\n\n` +
        `DM Subscribers: ${result.dmResult.total}\n` +
        `DM Sent: ${result.dmResult.successCount}\n` +
        `DM Failed: ${result.dmResult.failCount}\n` +
        `Channel Posts: ${result.channelResult.postedCount}\n` +
        `Channel Failures: ${result.channelResult.failedCount}\n` +
        `Ping Everyone: ${pingEveryone ? 'Yes' : 'No'}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'testyt') {
    const embed = buildYoutubeEmbed({
      title: 'This is a branded test video',
      link: 'https://youtube.com',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    });

    await interaction.deferReply();
    await interaction.editReply({
      content: 'Test YouTube alert:',
      embeds: [embed],
      components: [buildWebsiteButtonRow()],
    });

    const replyMessage = await interaction.fetchReply();
    await addReactions(replyMessage, YT_REACTIONS);
    return;
  }

  if (interaction.commandName === 'setupalerts') {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('🔔 TTT Promo Alerts')
      .setDescription(
        `Join **5000+ traders** getting:\n\n• Promo codes\n• Limited-time discounts\n• Competitions & giveaways\n• Important updates\n\n⚡ Only subscribers receive certain drops first.`
      )
      .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
      .setTimestamp();

    await interaction.deferReply();
    await interaction.editReply({
      embeds: [embed],
      components: [buildSubscriptionButtons(), buildWebsiteButtonRow()],
    });
    return;
  }

  if (interaction.commandName === 'subscriberstats') {
    const count = await getSubscriberCount();
    const stats = await getStats();

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Subscriber Stats')
      .setDescription(
        `Current subscribers: **${count}**\n\n` +
          `Total alerts run: **${stats.totalAlertsRun}**\n` +
          `Total DMs sent: **${stats.totalDmSent}**\n` +
          `Total DM failures: **${stats.totalDmFailed}**\n` +
          `Total channel posts: **${stats.totalChannelPosts}**\n` +
          `Total channel failures: **${stats.totalChannelFailures}**\n` +
          `Welcome channel posts: **${stats.totalWelcomePosts}**\n` +
          `Welcome DMs: **${stats.totalWelcomeDMs}**\n` +
          `Manual adds: **${stats.totalManualAdds}**\n` +
          `Manual removes: **${stats.totalManualRemoves}**\n` +
          `Last alert: **${stats.lastAlertAt || 'N/A'}**`
      )
      .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'listsubscribers') {
    const subscribers = await getSubscriberIds();

    const output = subscribers.length
      ? subscribers.map(id => `<@${id}> (${id})`).join('\n').slice(0, 1900)
      : 'No subscribers yet.';

    await interaction.reply({
      content: output,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'addsubscriber') {
    const user = interaction.options.getUser('user', true);
    const added = await addSubscriber(user.id);

    if (added) {
      await incrementStats({ totalManualAdds: 1 });
    }

    await interaction.reply({
      content: added
        ? `✅ Added ${user} to the subscriber list.`
        : `ℹ️ ${user} is already subscribed.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'removesubscriber') {
    const user = interaction.options.getUser('user', true);
    const removed = await removeSubscriber(user.id);

    if (removed) {
      await incrementStats({ totalManualRemoves: 1 });
    }

    await interaction.reply({
      content: removed
        ? `✅ Removed ${user} from the subscriber list.`
        : `ℹ️ ${user} was not subscribed.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'sendalert') {
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const sendDM = interaction.options.getBoolean('send_dm', true);
    const image = interaction.options.getAttachment('image');
    const postGeneral = interaction.options.getBoolean('general') || false;
    const postAnnouncements = interaction.options.getBoolean('announcements') || false;
    const postActivePromotions = interaction.options.getBoolean('active_promotions') || false;
    const pingEveryone = interaction.options.getBoolean('ping_everyone') || false;

    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: 'Sending alert...',
    });

    const embed = buildGenericEmbed({
      title,
      message,
      imageUrl: image?.url || null,
    });

    const result = await runBroadcast({
      embed,
      sendDM,
      general: postGeneral,
      announcements: postAnnouncements,
      activePromotions: postActivePromotions,
      pingEveryone,
    });

    await interaction.followUp({
      content:
        `Alert complete.\n\n` +
        `DM Subscribers: ${result.dmResult.total}\n` +
        `DM Sent: ${result.dmResult.successCount}\n` +
        `DM Failed: ${result.dmResult.failCount}\n` +
        `Channel Posts: ${result.channelResult.postedCount}\n` +
        `Channel Failures: ${result.channelResult.failedCount}\n` +
        `Ping Everyone: ${pingEveryone ? 'Yes' : 'No'}`,
      ephemeral: true,
    });
    return;
  }
});
function startCRMStatsServer() {
  const app = express();
  const port = process.env.PORT || 3000;
  const router = express.Router();

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'discord-bot',
      botReady: client.isReady(),
      botUsername: client.user?.tag || null,
      uptimeSeconds: Math.floor(process.uptime()),
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/crm-stats', async (req, res) => {
    try {
      if (!process.env.CRM_SHARED_SECRET) {
        return res.status(500).json({
          ok: false,
          error: 'CRM_SHARED_SECRET is not configured',
        });
      }

      if (req.query.secret !== process.env.CRM_SHARED_SECRET) {
        return res.status(401).json({
          ok: false,
          error: 'Unauthorized',
        });
      }

      const subscriberCount = await getSubscriberCount();
      const stats = await getStats();
      const lastVideoId = await getAppState('lastVideoId');

      const welcomedResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM welcomed_users`
      );

      res.json({
        ok: true,
        service: 'discord-bot',
        botStatus: client.isReady() ? 'ONLINE' : 'STARTING',
        botUsername: client.user?.tag || null,
        uptimeSeconds: Math.floor(process.uptime()),

        subscriberCount,
        welcomedUsersCount: welcomedResult.rows[0]?.count || 0,

        lastVideoId,
        lastAlertAt: stats.lastAlertAt || null,

        totals: {
          totalAlertsRun: stats.totalAlertsRun,
          totalDmSent: stats.totalDmSent,
          totalDmFailed: stats.totalDmFailed,
          totalChannelPosts: stats.totalChannelPosts,
          totalChannelFailures: stats.totalChannelFailures,
          totalWelcomePosts: stats.totalWelcomePosts,
          totalWelcomeDMs: stats.totalWelcomeDMs,
          totalManualAdds: stats.totalManualAdds,
          totalManualRemoves: stats.totalManualRemoves,
        },

        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('CRM stats endpoint failed:', error);

      res.status(500).json({
        ok: false,
        error: 'Server error',
      });
    }
  });

  router.use(requireCrmAuth);

  router.get('/health', asyncRoute(async (req, res) => {
    res.json(await getOverviewPayload());
  }));

  router.get('/overview', asyncRoute(async (req, res) => {
    res.json(await getOverviewPayload());
  }));

  router.get('/stats', asyncRoute(async (req, res) => {
    res.json(await getOverviewPayload());
  }));

  router.get('/channels', asyncRoute(async (req, res) => {
    const channels = await listAccessibleChannels();
    res.json({
      ok: true,
      channels,
      groups: groupChannelsByCategory(channels),
      generatedAt: new Date().toISOString(),
    });
  }));

  router.post('/channels/sync', asyncRoute(async (req, res) => {
    const channels = await listAccessibleChannels();
    await logActivity({
      type: 'channels',
      action: 'synced',
      actor: getActor(req),
      source: 'crm_api',
      metadata: { count: channels.length },
    });
    res.json({
      ok: true,
      channels,
      groups: groupChannelsByCategory(channels),
      generatedAt: new Date().toISOString(),
    });
  }));

  router.get('/subscribers', asyncRoute(async (req, res) => {
    res.json({
      ok: true,
      ...(await listSubscribers(req.query)),
    });
  }));

  router.get('/subscribers/:discordUserId', asyncRoute(async (req, res) => {
    const discordUserId = requireDiscordId(req.params.discordUserId);
    const subscriber = await getSubscriber(discordUserId);
    if (!subscriber) {
      return res.status(404).json({ ok: false, error: 'Subscriber not found' });
    }
    res.json({ ok: true, subscriber });
  }));

  router.post('/subscribers', asyncRoute(async (req, res) => {
    const discordUserId = requireDiscordId(req.body.discordUserId || req.body.userId);
    const added = await addSubscriber(discordUserId);
    if (added) {
      await incrementStats({ totalManualAdds: 1 });
      await logActivity({
        type: 'subscriber',
        action: 'added',
        actor: getActor(req),
        source: 'crm_api',
        discordUserId,
      });
    }
    res.status(added ? 201 : 200).json({
      ok: true,
      added,
      subscriber: await getSubscriber(discordUserId),
    });
  }));

  router.delete('/subscribers/:discordUserId', asyncRoute(async (req, res) => {
    const discordUserId = requireDiscordId(req.params.discordUserId);
    const removed = await removeSubscriber(discordUserId);
    if (removed) {
      await incrementStats({ totalManualRemoves: 1 });
      await logActivity({
        type: 'subscriber',
        action: 'removed',
        actor: getActor(req),
        source: 'crm_api',
        discordUserId,
      });
    }
    res.json({ ok: true, removed });
  }));

  router.get('/announcements', asyncRoute(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 50, 200);
    const offset = (parsePositiveInt(req.query.page, 1) - 1) * limit;
    const result = await pool.query(
      `
      SELECT id, title, message, image_url, payload, status, last_error, created_at, updated_at, sent_at
      FROM discord_announcements
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_announcements`);
    res.json({
      ok: true,
      total: countResult.rows[0]?.count || 0,
      announcements: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        message: row.message,
        imageUrl: row.image_url,
        payload: row.payload,
        status: row.status,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sentAt: row.sent_at,
      })),
    });
  }));

  router.post('/announcements', asyncRoute(async (req, res) => {
    const result = await createAnnouncement(req.body, req);
    res.status(201).json({ ok: true, ...result });
  }));

  router.get('/announcements/:id', asyncRoute(async (req, res) => {
    const announcement = await getAnnouncement(req.params.id);
    if (!announcement) {
      return res.status(404).json({ ok: false, error: 'Announcement not found' });
    }
    res.json({ ok: true, announcement });
  }));

  router.post('/announcements/:id/send', asyncRoute(async (req, res) => {
    const result = await sendAnnouncementById(req.params.id, req);
    res.json({ ok: true, result, announcement: await getAnnouncement(req.params.id) });
  }));

  router.get('/settings/welcome', asyncRoute(async (req, res) => {
    res.json({ ok: true, settings: await getSetting('welcome', DEFAULT_WELCOME_SETTINGS) });
  }));

  router.patch('/settings/welcome', asyncRoute(async (req, res) => {
    const allowed = [
      'enabled',
      'welcomeChannelId',
      'sendChannelMessage',
      'sendDm',
      'autoSubscribeNewMember',
      'channelTemplate',
      'dmTemplate',
      'embedTitle',
      'description',
      'image',
      'thumbnail',
      'buttons',
      'delayMs',
      'reactions',
    ];
    const patch = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) patch[key] = req.body[key];
    }
    if (patch.welcomeChannelId) patch.welcomeChannelId = requireDiscordId(patch.welcomeChannelId, 'Welcome channel ID');
    if (patch.image) patch.image = validateUrl(patch.image, 'Image URL');
    if (patch.thumbnail) patch.thumbnail = validateUrl(patch.thumbnail, 'Thumbnail URL');
    if (patch.buttons) patch.buttons = sanitizeButtons(patch.buttons);
    if (patch.reactions) patch.reactions = sanitizeReactions(patch.reactions);
    validateTextLength(patch.embedTitle, 256, 'Embed title');
    validateTextLength(patch.description, 4096, 'Description');

    const settings = await updateSetting('welcome', DEFAULT_WELCOME_SETTINGS, patch);
    await logActivity({ type: 'settings', action: 'welcome_updated', actor: getActor(req), source: 'crm_api' });
    res.json({ ok: true, settings });
  }));

  router.post('/settings/welcome/test', asyncRoute(async (req, res) => {
    const settings = await getSetting('welcome', DEFAULT_WELCOME_SETTINGS);
    const channelId = req.body.channelId ? requireDiscordId(req.body.channelId, 'Channel ID') : settings.welcomeChannelId;
    const memberId = req.body.discordUserId ? requireDiscordId(req.body.discordUserId) : null;
    const guild = await getGuild();
    const member = memberId && guild ? await guild.members.fetch(memberId).catch(() => null) : null;
    const fakeMember = member || {
      id: memberId || client.user?.id || '0',
      user: { username: 'Test User' },
      displayName: 'Test User',
      toString: () => memberId ? `<@${memberId}>` : '@Test User',
    };
    const embed = buildWelcomeEmbed(fakeMember, settings);
    let message = null;

    if (channelId) {
      message = await sendToChannelId(
        channelId,
        {
          embed,
          components: [buildSubscriptionButtons(), ...buildButtonRows(settings.buttons || []).slice(0, 4)],
          content: renderTemplate(settings.channelTemplate || 'Welcome {member}.', { member: `${fakeMember}` }),
        },
        settings.reactions || []
      );
    }

    await logActivity({
      type: 'welcome',
      action: 'test',
      actor: getActor(req),
      source: 'crm_api',
      metadata: { channelId, messageId: message?.id || null },
    });
    res.json({ ok: true, sent: Boolean(message), messageId: message?.id || null });
  }));

  router.get('/settings/youtube', asyncRoute(async (req, res) => {
    res.json({ ok: true, settings: await getSetting('youtube', DEFAULT_YOUTUBE_SETTINGS) });
  }));

  router.patch('/settings/youtube', asyncRoute(async (req, res) => {
    const allowed = [
      'enabled',
      'youtubeChannelId',
      'feedUrl',
      'destinationChannelIds',
      'messageTemplate',
      'embedTitleFormat',
      'description',
      'websiteButton',
      'thumbnailBehavior',
      'reactionSet',
      'pollingIntervalMs',
      'autoPostShorts',
    ];
    const patch = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) patch[key] = req.body[key];
    }
    if (patch.feedUrl) patch.feedUrl = validateUrl(patch.feedUrl, 'Feed URL');
    if (patch.destinationChannelIds) {
      patch.destinationChannelIds = patch.destinationChannelIds
        .map(id => normalizeDiscordId(id))
        .filter(Boolean);
    }
    if (patch.websiteButton) patch.websiteButton = sanitizeButtons([patch.websiteButton])[0] || null;
    if (patch.reactionSet) patch.reactionSet = sanitizeReactions(patch.reactionSet, YT_REACTIONS);
    if (patch.pollingIntervalMs) patch.pollingIntervalMs = Math.max(60000, Number(patch.pollingIntervalMs) || POLLING_INTERVAL_MS);

    const settings = await updateSetting('youtube', DEFAULT_YOUTUBE_SETTINGS, patch);
    await logActivity({ type: 'settings', action: 'youtube_updated', actor: getActor(req), source: 'crm_api' });
    res.json({ ok: true, settings });
  }));

  router.post('/settings/youtube/test', asyncRoute(async (req, res) => {
    const channelIds = Array.isArray(req.body.channelIds)
      ? req.body.channelIds.map(id => normalizeDiscordId(id)).filter(Boolean)
      : [];
    const embed = buildYoutubeEmbed({
      id: 'test',
      title: req.body.title || 'This is a branded test video',
      link: req.body.link || 'https://youtube.com',
      thumbnail: req.body.thumbnail || 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    });
    const posts = [];
    for (const channelId of channelIds) {
      const msg = await sendToChannelId(channelId, { embed, components: [buildWebsiteButtonRow()] }, YT_REACTIONS);
      posts.push({ channelId, messageId: msg.id });
    }
    await logActivity({ type: 'youtube', action: 'test', actor: getActor(req), source: 'crm_api', metadata: { posts } });
    res.json({ ok: true, sent: posts.length > 0, posts });
  }));

  router.get('/youtube/history', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `
      SELECT id, action, entity_id, metadata, error_message, created_at
      FROM discord_activity_logs
      WHERE type = 'youtube'
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [parsePositiveInt(req.query.limit, 50, 200)]
    );
    res.json({ ok: true, history: result.rows });
  }));

  router.get('/templates', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM discord_templates ORDER BY updated_at DESC LIMIT $1`,
      [parsePositiveInt(req.query.limit, 100, 200)]
    );
    res.json({ ok: true, templates: result.rows });
  }));

  router.post('/templates', asyncRoute(async (req, res) => {
    const type = String(req.body.type || '').toUpperCase();
    if (!TEMPLATE_TYPES.has(type)) {
      return res.status(400).json({ ok: false, error: 'Invalid template type' });
    }
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Template name is required' });
    const result = await pool.query(
      `
      INSERT INTO discord_templates (type, name, content)
      VALUES ($1, $2, $3::jsonb)
      RETURNING *
      `,
      [type, name, JSON.stringify(req.body.content || {})]
    );
    await logActivity({ type: 'template', action: 'created', actor: getActor(req), source: 'crm_api', entityType: 'template', entityId: String(result.rows[0].id) });
    res.status(201).json({ ok: true, template: result.rows[0] });
  }));

  router.get('/templates/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_templates WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Template not found' });
    res.json({ ok: true, template: result.rows[0] });
  }));

  router.patch('/templates/:id', asyncRoute(async (req, res) => {
    const current = await pool.query(`SELECT * FROM discord_templates WHERE id = $1`, [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ ok: false, error: 'Template not found' });
    const next = {
      type: req.body.type ? String(req.body.type).toUpperCase() : current.rows[0].type,
      name: req.body.name || current.rows[0].name,
      content: req.body.content || current.rows[0].content,
    };
    if (!TEMPLATE_TYPES.has(next.type)) return res.status(400).json({ ok: false, error: 'Invalid template type' });
    const result = await pool.query(
      `
      UPDATE discord_templates
      SET type = $2, name = $3, content = $4::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [req.params.id, next.type, next.name, JSON.stringify(next.content)]
    );
    await logActivity({ type: 'template', action: 'updated', actor: getActor(req), source: 'crm_api', entityType: 'template', entityId: String(req.params.id) });
    res.json({ ok: true, template: result.rows[0] });
  }));

  router.delete('/templates/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_templates WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'template', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'template', entityId: String(req.params.id) });
    res.json({ ok: true, deleted: result.rowCount > 0 });
  }));

  router.get('/managed-posts', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM discord_managed_posts ORDER BY display_order ASC, updated_at DESC`
    );
    res.json({ ok: true, managedPosts: result.rows });
  }));

  router.post('/managed-posts', asyncRoute(async (req, res) => {
    const payload = normalizeManagedPayload(req.body);
    const result = await pool.query(
      `
      INSERT INTO discord_managed_posts
        (internal_name, channel_id, message_id, status, payload, display_order, template_id)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING *
      `,
      [
        payload.internalName,
        payload.channelId,
        payload.messageId,
        payload.status,
        JSON.stringify(payload),
        payload.displayOrder,
        payload.templateId,
      ]
    );
    await logActivity({ type: 'managed_post', action: 'created', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(result.rows[0].id) });
    res.status(201).json({ ok: true, managedPost: result.rows[0] });
  }));

  router.get('/managed-posts/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Managed post not found' });
    res.json({ ok: true, managedPost: result.rows[0] });
  }));

  router.patch('/managed-posts/:id', asyncRoute(async (req, res) => {
    const current = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ ok: false, error: 'Managed post not found' });
    const merged = { ...current.rows[0].payload, ...req.body };
    const payload = normalizeManagedPayload({
      ...merged,
      channelId: req.body.channelId || current.rows[0].channel_id,
      messageId: req.body.messageId || current.rows[0].message_id,
      internalName: req.body.internalName || current.rows[0].internal_name,
    });
    const result = await pool.query(
      `
      UPDATE discord_managed_posts
      SET internal_name = $2,
          channel_id = $3,
          message_id = $4,
          status = $5,
          payload = $6::jsonb,
          display_order = $7,
          template_id = $8,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        req.params.id,
        payload.internalName,
        payload.channelId,
        payload.messageId,
        payload.status,
        JSON.stringify(payload),
        payload.displayOrder,
        payload.templateId,
      ]
    );
    await logActivity({ type: 'managed_post', action: 'updated', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id) });
    res.json({ ok: true, managedPost: result.rows[0] });
  }));

  router.post('/managed-posts/:id/publish', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Managed post not found' });
    const managedPost = result.rows[0];
    const payload = managedPost.payload || {};

    try {
      const message = await editOrCreateManagedMessage({
        channelId: managedPost.channel_id,
        messageId: managedPost.message_id,
        payload: {
          title: payload.title || managedPost.internal_name,
          description: payload.description || '',
          content: payload.content || '',
          fields: payload.fields || [],
          imageUrl: payload.imageUrl || null,
          thumbnail: payload.thumbnail || null,
          footer: payload.footer || BRAND_FOOTER,
          embedColor: payload.embedColor || BRAND_COLOR,
          buttons: payload.buttons || [],
          pingEveryone: false,
        },
        reactions: payload.reactions || DEFAULT_MANAGED_REACTIONS,
      });

      const updateResult = await pool.query(
        `
        UPDATE discord_managed_posts
        SET message_id = $2,
            status = 'published',
            last_error = NULL,
            updated_at = NOW(),
            published_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id, message.id]
      );
      await logActivity({ type: 'managed_post', action: 'published', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id), metadata: { messageId: message.id } });
      res.json({ ok: true, managedPost: updateResult.rows[0] });
    } catch (error) {
      await pool.query(
        `UPDATE discord_managed_posts SET status = 'error', last_error = $2, updated_at = NOW() WHERE id = $1`,
        [req.params.id, error.message]
      );
      throw error;
    }
  }));

  router.post('/managed-posts/:id/sync-reactions', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Managed post not found' });
    const managedPost = result.rows[0];
    if (!managedPost.message_id) return res.status(400).json({ ok: false, error: 'Managed post has no Discord message ID' });
    const channel = await fetchTextChannel(managedPost.channel_id);
    const message = await channel.messages.fetch(managedPost.message_id);
    await addReactions(message, sanitizeReactions(managedPost.payload?.reactions, DEFAULT_MANAGED_REACTIONS).slice(0, 10));
    await logActivity({ type: 'managed_post', action: 'reaction_sync', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id) });
    res.json({ ok: true, synced: true });
  }));

  router.delete('/managed-posts/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'managed_post', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id) });
    res.json({ ok: true, deleted: result.rowCount > 0 });
  }));

  router.get('/activity', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `
      SELECT *
      FROM discord_activity_logs
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [parsePositiveInt(req.query.limit, 100, 500)]
    );
    res.json({ ok: true, activity: result.rows });
  }));

  router.get('/dm-campaigns', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM discord_dm_campaigns ORDER BY created_at DESC LIMIT $1`,
      [parsePositiveInt(req.query.limit, 100, 500)]
    );
    res.json({ ok: true, dmCampaigns: result.rows });
  }));

  router.get('/dm-campaigns/:id', asyncRoute(async (req, res) => {
    const campaign = await pool.query(`SELECT * FROM discord_dm_campaigns WHERE id = $1`, [req.params.id]);
    if (!campaign.rowCount) return res.status(404).json({ ok: false, error: 'DM campaign not found' });
    const deliveries = await pool.query(
      `SELECT * FROM discord_dm_deliveries WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ ok: true, dmCampaign: campaign.rows[0], deliveries: deliveries.rows });
  }));

  app.use('/api/crm/discord', router);
  app.use(sendApiError);

  app.listen(port, '0.0.0.0', () => {
    console.log(`CRM stats API listening on port ${port}`);
  });
}
(async () => {
  await initDB();
  startCRMStatsServer();
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
