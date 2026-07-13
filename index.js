require('dotenv').config();
const crypto = require('crypto');
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
let youtubeCheckRunning = false;

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
const CHANNEL_MAPPING_KEYS = [
  'general',
  'announcements',
  'active_promotions',
  'welcome',
  'youtube',
  'help',
  'trading_rules',
  'verified_links',
  'payout_proofs',
];
const ROLE_MAPPING_KEYS = ['subscriber', 'admin', 'moderator', 'member'];
const SECRET_DEFINITIONS = {
  DISCORD_TOKEN: { label: 'Discord bot token', requiresRestart: true },
  DISCORD_BOT_TOKEN: { label: 'Discord bot token fallback', requiresRestart: true },
  DISCORD_APP_ID: { label: 'Discord application ID', requiresRestart: true },
  DISCORD_GUILD_ID: { label: 'Discord guild ID', requiresRestart: true },
  DISCORD_PUBLIC_KEY: { label: 'Discord public key', requiresRestart: true },
  YOUTUBE_CHANNEL_ID: { label: 'YouTube channel ID', requiresRestart: false },
  YOUTUBE_API_KEY: { label: 'YouTube API key', requiresRestart: false },
  CRM_SHARED_SECRET: { label: 'CRM shared secret', requiresRestart: true },
  INTERNAL_WEBHOOK_SECRET: { label: 'Internal webhook secret', requiresRestart: false },
};

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

const DEFAULT_SUBSCRIBER_DM_DESCRIPTION =
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
  `We’ll point you in the right direction.`;

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

const DEFAULT_CORE_SETTINGS = {
  guildId: process.env.DISCORD_GUILD_ID || null,
  botDisplayName: BRAND_NAME,
  defaultColor: BRAND_COLOR,
  footer: BRAND_FOOTER,
  youtubeFooter: YT_FOOTER,
  logoUrl: LOGO_URL,
  websiteUrl: WEBSITE_URL,
  defaultReactions: {
    youtube: YT_REACTIONS,
    announcements: ANNOUNCE_REACTIONS,
    vip: VIP_REACTIONS,
    managedPosts: DEFAULT_MANAGED_REACTIONS,
  },
  featureToggles: {
    welcome: true,
    youtube: true,
    announcements: true,
    managedPosts: true,
    autoReactions: true,
  },
  announcementDefaults: {
    embedColor: BRAND_COLOR,
    footer: BRAND_FOOTER,
    reactions: ANNOUNCE_REACTIONS,
    pingEveryone: false,
    sendDm: false,
  },
  delays: {
    dmMs: 1200,
    reactionMs: 300,
    youtubePostMs: 1500,
  },
};

const DEFAULT_CHANNEL_MAPPINGS = {
  general: process.env.GENERAL_CHANNEL_ID || null,
  announcements: process.env.ANNOUNCEMENTS_CHANNEL_ID || null,
  active_promotions: process.env.ACTIVE_PROMOTIONS_CHANNEL_ID || null,
  welcome: process.env.WELCOME_CHANNEL_ID || null,
  youtube: process.env.DISCORD_CHANNEL_ID || null,
  help: null,
  trading_rules: null,
  verified_links: null,
  payout_proofs: null,
};

const DEFAULT_ROLE_MAPPINGS = {
  subscriber: process.env.SUBSCRIBER_ROLE_ID || null,
  admin: null,
  moderator: null,
  member: null,
};

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      user_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'subscribed';`);
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;`);
  await pool.query(`UPDATE subscribers SET status = 'subscribed' WHERE status IS NULL OR status = '';`);

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
    ALTER TABLE discord_settings
    ADD COLUMN IF NOT EXISTS group_key TEXT NOT NULL DEFAULT 'general';
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

  await pool.query(`
    ALTER TABLE discord_dm_campaigns
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE discord_dm_campaigns
    ADD COLUMN IF NOT EXISTS last_processed_recipient TEXT;
  `);

  await pool.query(`
    ALTER TABLE discord_dm_campaigns
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_secret_settings (
      id BIGSERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      encrypted_value TEXT,
      iv TEXT,
      auth_tag TEXT,
      last_four TEXT,
      configured BOOLEAN NOT NULL DEFAULT false,
      requires_restart BOOLEAN NOT NULL DEFAULT false,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_channels (
      id TEXT PRIMARY KEY,
      guild_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      parent_category_id TEXT,
      parent_category_name TEXT,
      position INTEGER,
      can_view BOOLEAN NOT NULL DEFAULT false,
      can_send BOOLEAN NOT NULL DEFAULT false,
      can_send_threads BOOLEAN NOT NULL DEFAULT false,
      can_embed BOOLEAN NOT NULL DEFAULT false,
      can_attach_files BOOLEAN NOT NULL DEFAULT false,
      can_add_reactions BOOLEAN NOT NULL DEFAULT false,
      can_read_history BOOLEAN NOT NULL DEFAULT false,
      can_mention_everyone BOOLEAN NOT NULL DEFAULT false,
      can_use_external_emojis BOOLEAN NOT NULL DEFAULT false,
      can_manage_messages BOOLEAN NOT NULL DEFAULT false,
      managed BOOLEAN NOT NULL DEFAULT false,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_channel_mappings (
      key TEXT PRIMARY KEY,
      channel_id TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_role_mappings (
      key TEXT PRIMARY KEY,
      role_id TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_auto_reaction_rules (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
      react_to_bots BOOLEAN NOT NULL DEFAULT false,
      react_to_members BOOLEAN NOT NULL DEFAULT true,
      delay_ms INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_auto_reaction_users (
      id BIGSERIAL PRIMARY KEY,
      rule_id BIGINT NOT NULL REFERENCES discord_auto_reaction_rules(id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (rule_id, discord_user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_auto_reaction_channels (
      id BIGSERIAL PRIMARY KEY,
      rule_id BIGINT NOT NULL REFERENCES discord_auto_reaction_rules(id) ON DELETE CASCADE,
      discord_channel_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (rule_id, discord_channel_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_auto_reaction_events (
      message_id TEXT NOT NULL,
      rule_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, rule_id)
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

  await ensureSetting('core', DEFAULT_CORE_SETTINGS, 'core');
  await ensureSetting('welcome', DEFAULT_WELCOME_SETTINGS, 'welcome');
  await ensureSetting('youtube', DEFAULT_YOUTUBE_SETTINGS, 'youtube');
  await ensureSetting('channel_mappings', DEFAULT_CHANNEL_MAPPINGS, 'mappings');
  await ensureSetting('role_mappings', DEFAULT_ROLE_MAPPINGS, 'mappings');

  for (const [key, channelId] of Object.entries(DEFAULT_CHANNEL_MAPPINGS)) {
    await pool.query(
      `
      INSERT INTO discord_channel_mappings (key, channel_id)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
      `,
      [key, channelId]
    );
  }

  for (const [key, roleId] of Object.entries(DEFAULT_ROLE_MAPPINGS)) {
    await pool.query(
      `
      INSERT INTO discord_role_mappings (key, role_id)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
      `,
      [key, roleId]
    );
  }
}

async function addSubscriber(userId) {
  const result = await pool.query(
    `
    INSERT INTO subscribers (user_id, status, unsubscribed_at)
    VALUES ($1, 'subscribed', NULL)
    ON CONFLICT (user_id)
    DO UPDATE SET status = 'subscribed', unsubscribed_at = NULL
    WHERE subscribers.status IS DISTINCT FROM 'subscribed'
       OR subscribers.unsubscribed_at IS NOT NULL
    RETURNING user_id
    `,
    [userId]
  );

  return result.rowCount > 0;
}

async function removeSubscriber(userId) {
  const result = await pool.query(
    `
    UPDATE subscribers
    SET status = 'unsubscribed',
        unsubscribed_at = NOW()
    WHERE user_id = $1
      AND status IS DISTINCT FROM 'unsubscribed'
    RETURNING user_id
    `,
    [userId]
  );
  return result.rowCount > 0;
}

async function getSubscriberCount() {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM subscribers WHERE status = 'subscribed'`
  );
  return result.rows[0].count;
}

async function getSubscriberIds() {
  const result = await pool.query(
    `SELECT user_id FROM subscribers WHERE status = 'subscribed' ORDER BY created_at ASC`
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

function normalizeButtonUrl(value, label = 'Button URL') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return `mailto:${raw}`;
  }
  if (/^mailto:/i.test(raw)) {
    const email = raw.replace(/^mailto:/i, '').split('?')[0];
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return raw;
  }
  return validateUrl(raw, label);
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
      url: button?.url ? normalizeButtonUrl(button.url, 'Button URL') : null,
    }))
    .filter(button => button.label && button.url)
    .slice(0, 25);
}

function sanitizeManagedBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];

  return blocks
    .map((block, index) => {
      const type = String(block?.type || 'text').trim().toLowerCase();
      return {
        id: String(block?.id || `block-${index + 1}`),
        type: ['heading', 'note', 'button_group'].includes(type) ? type : 'text',
        content: String(block?.content || '').trim(),
        buttons: sanitizeButtons(block?.buttons || []),
      };
    })
    .filter(block => block.content || block.buttons.length)
    .slice(0, 20);
}

function managedDescriptionFromPayload(payload) {
  const lines = [];
  if (payload.description) lines.push(String(payload.description).trim());

  for (const block of sanitizeManagedBlocks(payload.contentBlocks)) {
    const blockLines = [];
    if (block.content && block.type !== 'button_group') {
      if (block.type === 'heading') blockLines.push(`**${block.content}**`);
      else if (block.type === 'note') blockLines.push(`> ${block.content.replace(/\n/g, '\n> ')}`);
      else blockLines.push(block.content);
    }
    const inlineLinks = sanitizeButtons(block.buttons || []).map(button => `[${button.label}](${button.url})`);
    if (inlineLinks.length) blockLines.push(inlineLinks.join('  |  '));
    if (blockLines.length) lines.push(blockLines.join('\n'));
  }

  return lines.filter(Boolean).join('\n\n').slice(0, 4096);
}

function managedButtonsFromPayload(payload) {
  return sanitizeButtons(payload.buttons || []).slice(0, 25);
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

function apiSuccess(res, data = [], { page = 1, pageSize = 50, total = null, extra = {}, status = 200 } = {}) {
  const pagination = {
    page,
    pageSize,
    total: total === null ? (Array.isArray(data) ? data.length : 0) : total,
  };

  return res.status(status).json({
    ok: true,
    data,
    pagination,
    ...extra,
  });
}

function createApiError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getEncryptionKey() {
  const raw = process.env.DISCORD_SETTINGS_ENCRYPTION_KEY;
  if (!raw) return null;

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecretValue(value) {
  const key = getEncryptionKey();
  if (!key) {
    throw createApiError(
      'ENCRYPTION_KEY_MISSING',
      'DISCORD_SETTINGS_ENCRYPTION_KEY is not configured',
      500
    );
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    lastFour: String(value).slice(-4),
  };
}

function getSecretDefinition(secretKey) {
  return SECRET_DEFINITIONS[secretKey] || {
    label: secretKey,
    requiresRestart: false,
  };
}

function serializeSecret(row) {
  const definition = getSecretDefinition(row.key);

  return {
    id: row.id,
    key: row.key,
    label: definition.label,
    configured: Boolean(row.configured),
    lastFour: row.last_four || null,
    requiresRestart: Boolean(row.requires_restart),
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureSetting(key, defaults, groupKey = 'general') {
  await pool.query(
    `
    INSERT INTO discord_settings (key, value, group_key)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (key) DO NOTHING
    `,
    [key, JSON.stringify(defaults), groupKey]
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

async function setSetting(key, value, groupKey = 'general') {
  await pool.query(
    `
    INSERT INTO discord_settings (key, value, group_key, updated_at)
    VALUES ($1, $2::jsonb, $3, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, group_key = EXCLUDED.group_key, updated_at = NOW()
    `,
    [key, JSON.stringify(value), groupKey]
  );

  return value;
}

async function setSettings(settings, groupKey = 'general') {
  const entries = Object.entries(settings || {});
  for (const [key, value] of entries) {
    await setSetting(key, value, groupKey);
  }
  return settings;
}

async function deleteSetting(key) {
  const result = await pool.query(
    `DELETE FROM discord_settings WHERE key = $1`,
    [key]
  );
  return result.rowCount > 0;
}

async function getSettingsByGroup(groupKey) {
  const result = await pool.query(
    `SELECT key, value, group_key, created_at, updated_at FROM discord_settings WHERE group_key = $1 ORDER BY key ASC`,
    [groupKey]
  );

  return result.rows.map(row => ({
    key: row.key,
    value: row.value,
    group: row.group_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function getChannelMappings() {
  const result = await pool.query(
    `SELECT key, channel_id, updated_by, created_at, updated_at FROM discord_channel_mappings ORDER BY key ASC`
  );
  const values = { ...DEFAULT_CHANNEL_MAPPINGS };

  for (const row of result.rows) {
    values[row.key] = row.channel_id;
  }

  return values;
}

async function getRoleMappings() {
  const result = await pool.query(
    `SELECT key, role_id, updated_by, created_at, updated_at FROM discord_role_mappings ORDER BY key ASC`
  );
  const values = { ...DEFAULT_ROLE_MAPPINGS };

  for (const row of result.rows) {
    values[row.key] = row.role_id;
  }

  return values;
}

async function resolveChannelMapping(key) {
  const mappings = await getChannelMappings();
  return mappings[key] || null;
}

async function resolveRoleMapping(key) {
  const mappings = await getRoleMappings();
  return mappings[key] || null;
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

function parseActivityMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch (_) {
    return {};
  }
}

function serializeActivityLog(row) {
  const metadata = parseActivityMetadata(row.metadata);
  const status = row.error_message ? 'failed' : metadata.status || 'ok';
  const channelId = metadata.channelId || metadata.discordChannelId || metadata.channel_id || null;
  const channelName = metadata.channelName || metadata.discordChannelName || metadata.channel_name || channelId || null;
  const messageId = metadata.messageId || metadata.discordMessageId || metadata.message_id || null;
  const fallbackMessage = [row.type, row.action].filter(Boolean).join('.');

  return {
    id: row.id,
    type: row.type,
    action: row.action,
    status,
    source: row.source,
    discordUserId: row.discord_user_id || metadata.discordUserId || metadata.userId || null,
    channelId,
    channelName,
    messageId,
    adminActor: row.actor || metadata.adminActor || metadata.actor || null,
    actor: row.actor || metadata.actor || null,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    message: row.error_message || metadata.message || metadata.summary || metadata.title || metadata.description || messageId || fallbackMessage,
    error: row.error_message || null,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

async function getWelcomedCount() {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM welcomed_users`
  );
  return result.rows[0]?.count || 0;
}

async function getGuild() {
  if (!client.isReady()) return null;
  const core = await getSetting('core', DEFAULT_CORE_SETTINGS);
  const guildId = core.guildId || process.env.DISCORD_GUILD_ID;
  if (!guildId) return null;
  return client.guilds.cache.get(guildId)
    || client.guilds.fetch(guildId).catch(() => null);
}

async function getOverviewPayload() {
  const [subscriberCount, welcomedUsersCount, stats, lastVideoId, lastYoutubePostAt, lastYoutubeCheckAt, guild, managedPages, activeCampaigns, autoReactionRules, recentActivity] =
    await Promise.all([
      getSubscriberCount(),
      getWelcomedCount(),
      getStats(),
      getAppState('lastVideoId'),
      getAppState('lastYoutubePostAt'),
      getAppState('lastYoutubeCheckAt'),
      getGuild(),
      pool.query(`SELECT COUNT(*)::int AS count FROM discord_managed_posts`).then(r => r.rows[0]?.count || 0).catch(() => null),
      pool.query(`SELECT COUNT(*)::int AS count FROM discord_dm_campaigns WHERE status IN ('QUEUED', 'RUNNING', 'PAUSED')`).then(r => r.rows[0]?.count || 0).catch(() => null),
      pool.query(`SELECT COUNT(*)::int AS count FROM discord_auto_reaction_rules WHERE enabled = true`).then(r => r.rows[0]?.count || 0).catch(() => null),
      pool.query(`SELECT type, action, created_at, metadata FROM discord_activity_logs ORDER BY created_at DESC LIMIT 10`).then(r => r.rows).catch(() => []),
    ]);

  return {
    ok: true,
    apiHealthy: true,
    databaseConnected: true,
    discordConnected: client.isReady(),
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
    lastYoutubeCheckAt,
    managedPages,
    activeCampaigns,
    autoReactionRules,
    recentActivity,
    queue: {
      youtubePollingActive: Boolean(youtubeIntervalHandle),
      activeJobs: activeCampaigns || 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

function channelTypeName(type) {
  const names = {
    [ChannelType.GuildCategory]: 'CATEGORY',
    [ChannelType.GuildText]: 'TEXT',
    [ChannelType.GuildAnnouncement]: 'ANNOUNCEMENT',
    [ChannelType.GuildForum]: 'FORUM',
    [ChannelType.GuildVoice]: 'VOICE',
    [ChannelType.GuildStageVoice]: 'STAGE',
  };

  return names[type] || String(type);
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
        type: channelTypeName(channel.type),
        rawType: channel.type,
        parentCategoryId: parent?.id || null,
        parentCategoryName: parent?.name || null,
        position: channel.rawPosition ?? channel.position ?? null,
        canView: permissions?.has(PermissionFlagsBits.ViewChannel) || false,
        canSend: permissions?.has(PermissionFlagsBits.SendMessages) || false,
        canSendThreads: permissions?.has(PermissionFlagsBits.SendMessagesInThreads) || false,
        canEmbed: permissions?.has(PermissionFlagsBits.EmbedLinks) || false,
        canAttachFiles: permissions?.has(PermissionFlagsBits.AttachFiles) || false,
        canAddReactions: permissions?.has(PermissionFlagsBits.AddReactions) || false,
        canReadHistory: permissions?.has(PermissionFlagsBits.ReadMessageHistory) || false,
        canMentionEveryone: permissions?.has(PermissionFlagsBits.MentionEveryone) || false,
        canUseExternalEmojis: permissions?.has(PermissionFlagsBits.UseExternalEmojis) || false,
        canManageMessages: permissions?.has(PermissionFlagsBits.ManageMessages) || false,
        managed: Boolean(channel.managed),
      };
    })
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

async function syncAccessibleChannels() {
  const guild = await getGuild();
  const channels = await listAccessibleChannels();

  for (const channel of channels) {
    await pool.query(
      `
      INSERT INTO discord_channels (
        id, guild_id, name, type, parent_category_id, parent_category_name, position,
        can_view, can_send, can_send_threads, can_embed, can_attach_files, can_add_reactions,
        can_read_history, can_mention_everyone, can_use_external_emojis, can_manage_messages,
        managed, raw, synced_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19::jsonb, NOW(), NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        guild_id = EXCLUDED.guild_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        parent_category_id = EXCLUDED.parent_category_id,
        parent_category_name = EXCLUDED.parent_category_name,
        position = EXCLUDED.position,
        can_view = EXCLUDED.can_view,
        can_send = EXCLUDED.can_send,
        can_send_threads = EXCLUDED.can_send_threads,
        can_embed = EXCLUDED.can_embed,
        can_attach_files = EXCLUDED.can_attach_files,
        can_add_reactions = EXCLUDED.can_add_reactions,
        can_read_history = EXCLUDED.can_read_history,
        can_mention_everyone = EXCLUDED.can_mention_everyone,
        can_use_external_emojis = EXCLUDED.can_use_external_emojis,
        can_manage_messages = EXCLUDED.can_manage_messages,
        managed = EXCLUDED.managed,
        raw = EXCLUDED.raw,
        synced_at = NOW(),
        updated_at = NOW()
      `,
      [
        channel.id,
        guild?.id || process.env.DISCORD_GUILD_ID || null,
        channel.name,
        channel.type,
        channel.parentCategoryId,
        channel.parentCategoryName,
        channel.position,
        channel.canView,
        channel.canSend,
        channel.canSendThreads,
        channel.canEmbed,
        channel.canAttachFiles,
        channel.canAddReactions,
        channel.canReadHistory,
        channel.canMentionEveryone,
        channel.canUseExternalEmojis,
        channel.canManageMessages,
        channel.managed,
        JSON.stringify(channel),
      ]
    );
  }

  return {
    guild: guild ? {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL?.() || null,
      memberCount: guild.memberCount || null,
    } : null,
    channels,
    groups: groupChannelsByCategory(channels),
  };
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

async function listSubscribers({ page = 1, limit = 50, search = '', includeUsers = true }) {
  const safePage = parsePositiveInt(page, 1);
  const safeLimit = parsePositiveInt(limit, 50, 1000);
  const offset = (safePage - 1) * safeLimit;
  const like = `%${String(search || '').trim()}%`;
  const params = search ? [like, safeLimit, offset] : [safeLimit, offset];

  const rowsQuery = search
    ? `
      SELECT user_id, created_at, status, unsubscribed_at
      FROM subscribers
      WHERE user_id ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `
    : `
      SELECT user_id, created_at, status, unsubscribed_at
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

  const subscribers = [];
  for (const row of rowsResult.rows) {
    subscribers.push(await serializeSubscriberRow(row, { includeUser: includeUsers }));
  }

  return {
    page: safePage,
    limit: safeLimit,
    total: countResult.rows[0]?.count || 0,
    subscribers,
  };
}

async function getSubscriber(discordUserId) {
  const result = await pool.query(
    `SELECT user_id, created_at, status, unsubscribed_at FROM subscribers WHERE user_id = $1`,
    [discordUserId]
  );

  if (!result.rowCount) return null;

  return serializeSubscriberRow(result.rows[0]);
}

async function getSubscriberDmStats(discordUserId) {
  const result = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_attempts,
      COUNT(*) FILTER (WHERE LOWER(status) = 'sent')::int AS total_successes,
      COUNT(*) FILTER (WHERE LOWER(status) <> 'sent')::int AS total_failures,
      MAX(created_at) AS last_dm_date,
      (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS last_dm_result
    FROM discord_dm_deliveries
    WHERE discord_user_id = $1
    `,
    [discordUserId]
  );

  return result.rows[0] || {};
}

async function getSubscriberDeliveryStats() {
  const result = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_attempts,
      COUNT(*) FILTER (WHERE LOWER(status) = 'sent')::int AS total_successes,
      COUNT(*) FILTER (WHERE LOWER(status) <> 'sent')::int AS total_failures,
      MAX(created_at) AS last_delivery_at,
      (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS last_delivery_status
    FROM discord_dm_deliveries
    `
  );
  const campaigns = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_campaigns,
      COUNT(*) FILTER (WHERE LOWER(status) IN ('completed', 'partial'))::int AS completed_campaigns,
      COUNT(*) FILTER (WHERE LOWER(status) IN ('queued', 'running'))::int AS running_campaigns,
      COUNT(*) FILTER (WHERE LOWER(status) = 'failed')::int AS failed_campaigns
    FROM discord_dm_campaigns
    `
  );
  const delivery = result.rows[0] || {};
  const campaign = campaigns.rows[0] || {};
  return {
    totalAttempts: Number(delivery.total_attempts || 0),
    totalSuccesses: Number(delivery.total_successes || 0),
    totalFailures: Number(delivery.total_failures || 0),
    lastDeliveryAt: delivery.last_delivery_at || null,
    lastDeliveryStatus: delivery.last_delivery_status || null,
    totalCampaigns: Number(campaign.total_campaigns || 0),
    completedCampaigns: Number(campaign.completed_campaigns || 0),
    runningCampaigns: Number(campaign.running_campaigns || 0),
    failedCampaigns: Number(campaign.failed_campaigns || 0),
  };
}

async function serializeSubscriberRow(row, { includeUser = true } = {}) {
  let user = null;
  if (includeUser && client.isReady()) {
    user = await client.users.fetch(row.user_id).catch(() => null);
  }
  const dmStats = await getSubscriberDmStats(row.user_id);

  return {
    discordUserId: row.user_id,
    username: user?.username || null,
    displayName: user?.globalName || user?.username || null,
    avatar: user?.displayAvatarURL?.() || null,
    status: row.status || 'subscribed',
    subscriptionStatus: row.status === 'unsubscribed' ? 'Unsubscribed' : 'Subscribed',
    dateSubscribed: row.created_at,
    unsubscribedAt: row.unsubscribed_at || null,
    source: 'subscriber_table',
    lastDmDate: dmStats.last_dm_date || null,
    lastDmResult: dmStats.last_dm_result || null,
    totalAttempts: dmStats.total_attempts || 0,
    totalSuccesses: dmStats.total_successes || 0,
    totalFailures: dmStats.total_failures || 0,
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

function buildWebsiteButtonRow({ label = 'Visit Website', url = WEBSITE_URL } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(String(label || 'Visit Website').slice(0, 80))
      .setStyle(ButtonStyle.Link)
      .setURL(validateUrl(url || WEBSITE_URL, 'Button URL'))
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

function buildWelcomeEmbed(member, settings = DEFAULT_WELCOME_SETTINGS, descriptionOverride = null) {
  const values = {
    member: `${member}`,
    username: member.user?.username || member.displayName || 'there',
    brandName: BRAND_NAME,
    websiteUrl: WEBSITE_URL,
  };
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(renderTemplate(settings.embedTitle || `Welcome to ${BRAND_NAME}`, values))
    .setDescription(renderTemplate(descriptionOverride || settings.description || DEFAULT_WELCOME_SETTINGS.description, values))
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

  const sendableTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  if (!channel || !sendableTypes.has(channel.type)) {
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
  const mappedYoutubeChannel = await resolveChannelMapping('youtube');
  const channelIds = Array.isArray(settings.destinationChannelIds) && settings.destinationChannelIds.length
    ? settings.destinationChannelIds
    : [mappedYoutubeChannel || process.env.DISCORD_CHANNEL_ID].filter(Boolean);
  const embed = buildYoutubeEmbed(video);
  let postedCount = 0;
  let failedCount = 0;

  for (const channelId of channelIds) {
    try {
      const msg = await sendToChannelId(
        channelId,
        {
          embed,
          components: [buildWebsiteButtonRow({ label: 'Watch video', url: video.link })],
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
  if (youtubeCheckRunning) {
    console.log('YouTube check skipped: previous check still running.');
    return;
  }
  youtubeCheckRunning = true;
  try {
    const settings = await getSetting('youtube', DEFAULT_YOUTUBE_SETTINGS);
    if (!settings.enabled) return;
    await setAppState('lastYoutubeCheckAt', new Date().toISOString());

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

    const newestVideoId = recentItems[0]?.id?.split(':').pop();
    if (!newestVideoId || newestVideoId === lastVideoId) return;

    const unseenItems = [];
    for (const item of recentItems) {
      const videoId = item.id?.split(':').pop();
      if (!videoId || videoId === lastVideoId) break;
      unseenItems.push({ ...item, videoId });
    }

    await setAppState('lastVideoId', newestVideoId);

    const video = unseenItems.find(item => settings.autoPostShorts || !looksLikeShort(item));
    if (video) {
      await postYoutubeVideo({
        id: video.videoId,
        title: video.title,
        link: video.link,
        thumbnail: getYoutubeThumbnail(video.videoId),
      });
      console.log(`Posted newest YouTube video: ${video.videoId}. Skipped ${Math.max(0, unseenItems.length - 1)} older unseen item(s).`);
    } else {
      console.log(`No eligible YouTube video to post. Marked newest seen item: ${newestVideoId}.`);
    }
  } catch (error) {
    console.error('YouTube check failed:', error.message);
  } finally {
    youtubeCheckRunning = false;
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
    ['Broadcast DM', 'RUNNING', subscribers.length]
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
      [failCount ? 'PARTIAL' : 'COMPLETED', successCount, failCount, campaignId]
    );
  }

  return {
    total: subscribers.length,
    successCount,
    failCount,
    campaignId,
  };
}

async function createDmCampaign({ name, announcementId = null, recipientIds = [], payload = {}, actor = null }) {
  const result = await pool.query(
    `
    INSERT INTO discord_dm_campaigns
      (announcement_id, name, status, total_count, metadata)
    VALUES ($1, $2, 'QUEUED', $3, $4::jsonb)
    RETURNING *
    `,
    [
      announcementId,
      name || 'Subscriber DM Campaign',
      recipientIds.length,
      JSON.stringify({ recipientIds, payload, actor }),
    ]
  );

  return result.rows[0];
}

async function processDmCampaign(campaignId) {
  const campaignResult = await pool.query(
    `SELECT * FROM discord_dm_campaigns WHERE id = $1`,
    [campaignId]
  );
  if (!campaignResult.rowCount) return;

  const campaign = campaignResult.rows[0];
  if (!['QUEUED', 'RUNNING'].includes(campaign.status)) return;

  const metadata = campaign.metadata || {};
  const recipientIds = Array.isArray(metadata.recipientIds) ? metadata.recipientIds : [];
  const payload = metadata.payload || {};
  const embed = buildPayloadEmbed(payload);
  const components = buildButtonRows(payload.buttons || []);
  let successCount = campaign.success_count || 0;
  let failureCount = campaign.failure_count || 0;

  await pool.query(
    `
    UPDATE discord_dm_campaigns
    SET status = 'RUNNING', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
    WHERE id = $1
    `,
    [campaignId]
  );

  for (const userId of recipientIds) {
    const already = await pool.query(
      `SELECT 1 FROM discord_dm_deliveries WHERE campaign_id = $1 AND discord_user_id = $2 LIMIT 1`,
      [campaignId, userId]
    );
    if (already.rowCount) continue;

    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [embed],
        components: components.length ? components : [buildWebsiteButtonRow()],
      });
      successCount += 1;
      await pool.query(
        `
        INSERT INTO discord_dm_deliveries (campaign_id, discord_user_id, status)
        VALUES ($1, $2, 'sent')
        `,
        [campaignId, userId]
      );
    } catch (error) {
      failureCount += 1;
      await pool.query(
        `
        INSERT INTO discord_dm_deliveries (campaign_id, discord_user_id, status, error_message)
        VALUES ($1, $2, 'failed', $3)
        `,
        [campaignId, userId, error.message]
      );
    }

    await pool.query(
      `
      UPDATE discord_dm_campaigns
      SET success_count = $2,
          failure_count = $3,
          last_processed_recipient = $4,
          updated_at = NOW()
      WHERE id = $1
      `,
      [campaignId, successCount, failureCount, userId]
    );
    await sleep(DEFAULT_CORE_SETTINGS.delays.dmMs);
  }

  const finalStatus = failureCount > 0
    ? (successCount > 0 ? 'PARTIAL' : 'FAILED')
    : 'COMPLETED';

  await pool.query(
    `
    UPDATE discord_dm_campaigns
    SET status = $2,
        success_count = $3,
        failure_count = $4,
        updated_at = NOW(),
        completed_at = NOW()
    WHERE id = $1
    `,
    [campaignId, finalStatus, successCount, failureCount]
  );

  await incrementStats({
    totalDmSent: successCount,
    totalDmFailed: failureCount,
  });

  await logActivity({
    type: 'campaign',
    action: 'completed',
    source: 'bot',
    entityType: 'dm_campaign',
    entityId: String(campaignId),
    metadata: { successCount, failureCount, finalStatus },
  });
}

function startDmCampaign(campaignId) {
  setImmediate(() => {
    processDmCampaign(campaignId).catch(error => {
      console.error(`DM campaign ${campaignId} failed:`, error.message);
      pool.query(
        `UPDATE discord_dm_campaigns SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
        [campaignId]
      ).catch(() => {});
    });
  });
}

async function sendEmbedToSelectedChannels(embed, options) {
  const mappings = await getChannelMappings();
  const channelTargets = Array.isArray(options.channelIds)
    ? options.channelIds.map(id => ({ enabled: true, id, label: id }))
    : [
      { enabled: options.general, id: mappings.general || process.env.GENERAL_CHANNEL_ID, label: 'general' },
      { enabled: options.announcements, id: mappings.announcements || process.env.ANNOUNCEMENTS_CHANNEL_ID, label: 'announcements' },
      { enabled: options.activePromotions, id: mappings.active_promotions || process.env.ACTIVE_PROMOTIONS_CHANNEL_ID, label: 'active-promotions' },
    ];

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

  const extraButtonRows = buildButtonRows(settings.buttons || []).slice(0, 4);
  const components = [buildSubscriptionButtons(), ...(extraButtonRows.length ? extraButtonRows : [buildWebsiteButtonRow()])];

  try {
    const welcomeChannelId = settings.welcomeChannelId
      || await resolveChannelMapping('welcome')
      || process.env.WELCOME_CHANNEL_ID;
    if (settings.sendChannelMessage && welcomeChannelId) {
      const channel = await client.channels.fetch(welcomeChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({
          content: renderTemplate(settings.channelTemplate || 'Welcome {member}.', {
            member: `${member}`,
            username: member.user?.username || member.displayName || 'there',
            brandName: BRAND_NAME,
          }),
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
  const desiredBotName = process.env.DISCORD_BOT_DISPLAY_NAME || 'TTT Markets';
  if (client.user?.username && client.user.username !== desiredBotName) {
    try {
      await client.user.setUsername(desiredBotName);
      console.log(`Bot display name set to ${desiredBotName}`);
    } catch (error) {
      console.log(`Unable to update bot display name to ${desiredBotName}: ${error.message}`);
    }
  }

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
      error: {
        code: 'CRM_SECRET_MISSING',
        message: 'CRM authentication is not configured',
      },
    });
  }

  const authHeader = req.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const providedSecret = req.get('x-crm-secret') || bearerToken || req.query.secret;
  const timestamp = req.get('x-crm-timestamp');
  const signature = req.get('x-crm-signature');

  if (timestamp && signature) {
    const timestampMs = Number(timestamp);
    const withinWindow = Number.isFinite(timestampMs)
      && Math.abs(Date.now() - timestampMs) <= 5 * 60 * 1000;
    const body = req.rawBody || '';
    const expected = crypto
      .createHmac('sha256', process.env.CRM_SHARED_SECRET)
      .update(`${timestamp}.${req.method}.${req.originalUrl}.${body}`)
      .digest('hex');
    const validSignature = signature.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (withinWindow && validSignature) {
      return next();
    }
  }

  if (providedSecret !== process.env.CRM_SHARED_SECRET) {
    return res.status(401).json({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      },
    });
  }

  return next();
}

function sendApiError(error, req, res, next) {
  console.error(`${req.method} ${req.path} failed:`, error.message);
  logActivity({
    type: 'api',
    action: 'request_failed',
    actor: req ? getActor(req) : null,
    source: 'crm_api',
    metadata: { method: req.method, path: req.path },
    errorMessage: error.message,
  }).catch(() => {});
  res.status(error.status || 500).json({
    ok: false,
    error: {
      code: error.code || (error.status ? 'BAD_REQUEST' : 'SERVER_ERROR'),
      message: error.status ? error.message : 'Server error',
    },
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
  const mappedChannelKeys = Array.isArray(body.mappedChannels)
    ? body.mappedChannels.filter(key => CHANNEL_MAPPING_KEYS.includes(key))
    : [];
  const selectedSubscriberIds = Array.isArray(body.selectedSubscriberIds)
    ? body.selectedSubscriberIds.map(id => normalizeDiscordId(id)).filter(Boolean)
    : [];
  const payload = {
    title: String(body.title || '').trim(),
    message: String(body.message || body.description || '').trim(),
    imageUrl: body.imageUrl || null,
    thumbnail: body.thumbnail || null,
    channelIds,
    mappedChannelKeys,
    sendDm: toBoolean(body.sendToSubscribersByDm ?? body.sendDm, false),
    selectedSubscriberIds,
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
  const mappedChannels = await getChannelMappings();
  const mappedChannelIds = (payload.mappedChannelKeys || [])
    .map(key => mappedChannels[key])
    .filter(Boolean);
  const channelIds = Array.from(new Set([...(payload.channelIds || []), ...mappedChannelIds]));
  const embed = buildPayloadEmbed(payload);
  const buttonRows = buildButtonRows(payload.buttons || []);

  try {
    let campaign = null;
    if (payload.sendDm) {
      const recipientIds = payload.selectedSubscriberIds?.length
        ? payload.selectedSubscriberIds
        : await getSubscriberIds();
      campaign = await createDmCampaign({
        name: `Announcement ${id}`,
        announcementId: id,
        recipientIds,
        payload,
        actor: req ? getActor(req) : null,
      });
      startDmCampaign(campaign.id);
    }

    const result = await runBroadcast({
      embed,
      sendDM: false,
      channelIds,
      pingEveryone: Boolean(payload.pingEveryone),
      components: buttonRows.length ? buttonRows : undefined,
      reactions: payload.reactions || ANNOUNCE_REACTIONS,
    });
    result.dmCampaign = campaign ? {
      id: campaign.id,
      status: campaign.status,
      totalCount: campaign.total_count,
    } : null;

    await pool.query(
      `
      UPDATE discord_announcements
      SET status = $2, sent_at = NOW(), updated_at = NOW(), last_error = NULL
      WHERE id = $1
      `,
      [id, campaign ? 'QUEUED' : 'COMPLETED']
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
  const status = payload.sendImmediately && !payload.saveAsDraft ? 'QUEUED' : 'DRAFT';

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
  const contentBlocks = sanitizeManagedBlocks(body.contentBlocks || body.blocks || body.payload?.contentBlocks || []);
  const payload = {
    internalName: String(body.internalName || body.name || '').trim(),
    channelId,
    messageId: body.messageId || body.discordMessageId || null,
    status: body.status || 'draft',
    displayOrder: Number.parseInt(body.displayOrder || 0, 10) || 0,
    templateId: null,
    title: body.title || body.payload?.title || body.internalName || 'TTT Markets',
    description: body.description || body.payload?.description || '',
    content: body.content || body.payload?.content || '',
    fields: body.fields || body.payload?.fields || [],
    imageUrl: body.imageUrl || body.image || body.payload?.imageUrl || null,
    thumbnail: body.thumbnail || body.payload?.thumbnail || null,
    footer: body.footer || body.payload?.footer || BRAND_FOOTER,
    embedColor: body.embedColor || body.color || body.payload?.embedColor || BRAND_COLOR,
    buttons: sanitizeButtons(body.buttons || body.payload?.buttons || []),
    contentBlocks,
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

function serializeManagedPost(row) {
  if (!row) return null;
  const payload = row.payload || {};
  return {
    id: row.id,
    internalName: row.internal_name || payload.internalName || '',
    name: row.internal_name || payload.internalName || '',
    channelId: row.channel_id || payload.channelId || '',
    discordMessageId: row.message_id || payload.messageId || null,
    messageId: row.message_id || payload.messageId || null,
    status: row.status || payload.status || 'draft',
    displayOrder: row.display_order ?? payload.displayOrder ?? 0,
    title: payload.title || row.internal_name || '',
    description: payload.description || '',
    content: payload.content || '',
    contentBlocks: sanitizeManagedBlocks(payload.contentBlocks || []),
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    imageUrl: payload.imageUrl || payload.image || null,
    image: payload.imageUrl || payload.image || null,
    thumbnail: payload.thumbnail || null,
    footer: payload.footer || BRAND_FOOTER,
    embedColour: payload.embedColour || payload.embedColor || BRAND_COLOR,
    embedColor: payload.embedColor || payload.embedColour || BRAND_COLOR,
    buttons: sanitizeButtons(payload.buttons || []),
    reactions: sanitizeReactions(payload.reactions, DEFAULT_MANAGED_REACTIONS).slice(0, 10),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPublishedAt: row.published_at || null,
    publishedAt: row.published_at || null,
    payload,
  };
}

async function getAutoReactionRule(id) {
  const ruleResult = await pool.query(
    `SELECT * FROM discord_auto_reaction_rules WHERE id = $1`,
    [id]
  );
  if (!ruleResult.rowCount) return null;

  const [usersResult, channelsResult] = await Promise.all([
    pool.query(`SELECT discord_user_id FROM discord_auto_reaction_users WHERE rule_id = $1 ORDER BY id ASC`, [id]),
    pool.query(`SELECT discord_channel_id FROM discord_auto_reaction_channels WHERE rule_id = $1 ORDER BY id ASC`, [id]),
  ]);

  const rule = ruleResult.rows[0];
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    reactions: rule.reactions || [],
    reactToBots: rule.react_to_bots,
    reactToMembers: rule.react_to_members,
    delayMs: rule.delay_ms,
    users: usersResult.rows.map(row => row.discord_user_id),
    channels: channelsResult.rows.map(row => row.discord_channel_id),
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}

async function listAutoReactionRules() {
  const result = await pool.query(
    `SELECT id FROM discord_auto_reaction_rules ORDER BY updated_at DESC`
  );
  const rules = [];
  for (const row of result.rows) {
    rules.push(await getAutoReactionRule(row.id));
  }
  return rules.filter(Boolean);
}

function normalizeAutoReactionPayload(body, existing = {}) {
  const name = String(body.name ?? existing.name ?? '').trim();
  if (!name) throw createApiError('AUTO_REACTION_NAME_REQUIRED', 'Rule name is required', 400);

  const reactions = sanitizeReactions(body.reactions ?? existing.reactions ?? [], []).slice(0, 13);
  if (reactions.length < 1) {
    throw createApiError('AUTO_REACTION_REACTIONS_REQUIRED', 'At least one reaction is required', 400);
  }

  const users = Array.isArray(body.users || body.discordUserIds)
    ? (body.users || body.discordUserIds).map(id => normalizeDiscordId(id)).filter(Boolean)
    : (existing.users || []);
  const channels = Array.isArray(body.channels || body.discordChannelIds)
    ? (body.channels || body.discordChannelIds).map(id => normalizeDiscordId(id)).filter(Boolean)
    : (existing.channels || []);

  return {
    name,
    enabled: toBoolean(body.enabled, existing.enabled ?? true),
    reactions,
    reactToBots: toBoolean(body.reactToBots ?? body.react_to_bots, existing.reactToBots ?? false),
    reactToMembers: toBoolean(body.reactToMembers ?? body.react_to_members, existing.reactToMembers ?? true),
    delayMs: Math.max(0, Math.min(Number(body.delayMs ?? existing.delayMs ?? 0) || 0, 30000)),
    users,
    channels,
  };
}

async function saveAutoReactionRule(payload, id = null) {
  let ruleId = id;
  if (ruleId) {
    await pool.query(
      `
      UPDATE discord_auto_reaction_rules
      SET name = $2,
          enabled = $3,
          reactions = $4::jsonb,
          react_to_bots = $5,
          react_to_members = $6,
          delay_ms = $7,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        ruleId,
        payload.name,
        payload.enabled,
        JSON.stringify(payload.reactions),
        payload.reactToBots,
        payload.reactToMembers,
        payload.delayMs,
      ]
    );
    await pool.query(`DELETE FROM discord_auto_reaction_users WHERE rule_id = $1`, [ruleId]);
    await pool.query(`DELETE FROM discord_auto_reaction_channels WHERE rule_id = $1`, [ruleId]);
  } else {
    const result = await pool.query(
      `
      INSERT INTO discord_auto_reaction_rules
        (name, enabled, reactions, react_to_bots, react_to_members, delay_ms)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6)
      RETURNING id
      `,
      [
        payload.name,
        payload.enabled,
        JSON.stringify(payload.reactions),
        payload.reactToBots,
        payload.reactToMembers,
        payload.delayMs,
      ]
    );
    ruleId = result.rows[0].id;
  }

  for (const userId of payload.users) {
    await pool.query(
      `INSERT INTO discord_auto_reaction_users (rule_id, discord_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ruleId, userId]
    );
  }

  for (const channelId of payload.channels) {
    await pool.query(
      `INSERT INTO discord_auto_reaction_channels (rule_id, discord_channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ruleId, channelId]
    );
  }

  return getAutoReactionRule(ruleId);
}

async function processAutoReactionRules(message) {
  if (!message?.author) return;
  if (message.author.id === client.user?.id) return;

  const rules = await listAutoReactionRules();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (message.author.bot && !rule.reactToBots) continue;
    if (!message.author.bot && !rule.reactToMembers) continue;
    if (rule.users.length && !rule.users.includes(message.author.id)) continue;
    if (rule.channels.length && !rule.channels.includes(message.channelId)) continue;

    const inserted = await pool.query(
      `
      INSERT INTO discord_auto_reaction_events (message_id, rule_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [message.id, rule.id]
    );
    if (!inserted.rowCount) continue;

    if (rule.delayMs) await sleep(rule.delayMs);

    let successCount = 0;
    let failureCount = 0;
    for (const reaction of rule.reactions) {
      try {
        await message.react(reaction);
        successCount += 1;
        await sleep(300);
      } catch (error) {
        failureCount += 1;
        console.log(`Auto reaction failed (${reaction}): ${error.message}`);
      }
    }

    await logActivity({
      type: 'auto_reaction',
      action: failureCount ? 'partial' : 'reacted',
      source: 'bot',
      discordUserId: message.author.id,
      entityType: 'auto_reaction_rule',
      entityId: String(rule.id),
      metadata: {
        messageId: message.id,
        channelId: message.channelId,
        username: message.author.username || null,
        successCount,
        failureCount,
      },
      errorMessage: failureCount ? `${failureCount} reaction(s) failed` : null,
    });
  }
}

client.on('messageCreate', async message => {
  if (message.author.id === client.user?.id) return;

  const isVIP = VIP_USERS.includes(message.author.id);

  if (!message.author.bot && isVIP && message.mentions.everyone) {
    await addReactions(message, VIP_REACTIONS);
  }

  await processAutoReactionRules(message);
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
          const settings = await getSetting('welcome', DEFAULT_WELCOME_SETTINGS);
          if (settings.sendDm === false) return;
          const dmMember = {
            id: userId,
            user: { username: user.username },
            displayName: user.globalName || user.username || 'there',
            toString: () => `<@${userId}>`,
          };
          const dmDescription = settings.dmTemplate || DEFAULT_SUBSCRIBER_DM_DESCRIPTION;

          const embed = buildWelcomeEmbed(dmMember, settings, dmDescription);

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
          const configuredRows = buildButtonRows(settings.buttons || []).slice(0, 5);

          await user.send({
            embeds: [embed],
            components: configuredRows.length ? configuredRows : [row],
          });
          await incrementStats({ totalWelcomeDMs: 1 });
          await logActivity({
            type: 'welcome',
            action: 'dm_sent',
            source: 'bot',
            discordUserId: userId,
            metadata: { trigger: 'subscribe_alerts' },
          });
        } catch (error) {
          console.log(`Failed to send subscriber welcome DM to ${userId}: ${error.message}`);
          await logActivity({
            type: 'welcome',
            action: 'dm_failed',
            source: 'bot',
            discordUserId: userId,
            metadata: { trigger: 'subscribe_alerts' },
            errorMessage: error.message,
          });
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

  app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }));

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
    const overview = await getOverviewPayload();
    apiSuccess(res, overview, { extra: overview });
  }));

  router.get('/overview', asyncRoute(async (req, res) => {
    const overview = await getOverviewPayload();
    apiSuccess(res, overview, { extra: overview });
  }));

  router.get('/stats', asyncRoute(async (req, res) => {
    const overview = await getOverviewPayload();
    apiSuccess(res, overview, { extra: overview });
  }));

  router.get('/channels', asyncRoute(async (req, res) => {
    const channels = await listAccessibleChannels();
    apiSuccess(res, channels, {
      pageSize: channels.length || 50,
      total: channels.length,
      extra: {
        channels,
        groups: groupChannelsByCategory(channels),
        generatedAt: new Date().toISOString(),
      },
    });
  }));

  router.post('/channels/sync', asyncRoute(async (req, res) => {
    const sync = await syncAccessibleChannels();
    await logActivity({
      type: 'channels',
      action: 'synced',
      actor: getActor(req),
      source: 'crm_api',
      metadata: { count: sync.channels.length },
    });
    apiSuccess(res, sync.channels, {
      pageSize: sync.channels.length || 50,
      total: sync.channels.length,
      extra: {
        guild: sync.guild,
        channels: sync.channels,
        groups: sync.groups,
        generatedAt: new Date().toISOString(),
      },
    });
  }));

  router.get('/server', asyncRoute(async (req, res) => {
    const sync = await syncAccessibleChannels();
    const server = {
      guild: sync.guild,
      categories: sync.channels.filter(channel => channel.type === 'CATEGORY'),
      textChannels: sync.channels.filter(channel => channel.type === 'TEXT'),
      announcementChannels: sync.channels.filter(channel => channel.type === 'ANNOUNCEMENT'),
      forumChannels: sync.channels.filter(channel => channel.type === 'FORUM'),
      voiceChannels: sync.channels.filter(channel => ['VOICE', 'STAGE'].includes(channel.type)),
      groups: sync.groups,
    };
    apiSuccess(res, server, { extra: server });
  }));

  router.get('/subscribers', asyncRoute(async (req, res) => {
    const [result, deliveryStats] = await Promise.all([
      listSubscribers({
      page: req.query.page,
      limit: req.query.limit || req.query.pageSize,
      search: req.query.search,
      includeUsers: req.query.includeUsers !== 'false',
      }),
      getSubscriberDeliveryStats(),
    ]);
    apiSuccess(res, { subscribers: result.subscribers, deliveryStats }, {
      page: result.page,
      pageSize: result.limit,
      total: result.total,
      extra: { subscribers: result.subscribers, deliveryStats },
    });
  }));

  router.get('/subscribers/:discordUserId', asyncRoute(async (req, res) => {
    const discordUserId = requireDiscordId(req.params.discordUserId);
    const subscriber = await getSubscriber(discordUserId);
    if (!subscriber) {
      throw createApiError('SUBSCRIBER_NOT_FOUND', 'Subscriber not found', 404);
    }
    apiSuccess(res, subscriber, { extra: { subscriber } });
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
    const subscriber = await getSubscriber(discordUserId);
    apiSuccess(res, subscriber, {
      status: added ? 201 : 200,
      extra: { added, subscriber },
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
    apiSuccess(res, { removed }, { extra: { removed } });
  }));

  router.get('/announcements', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit || req.query.pageSize, 50, 200);
    const offset = (page - 1) * limit;
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
    const announcements = result.rows.map(row => ({
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
      }));
    apiSuccess(res, announcements, {
      page,
      pageSize: limit,
      total: countResult.rows[0]?.count || 0,
      extra: { announcements },
    });
  }));

  router.post('/announcements', asyncRoute(async (req, res) => {
    const result = await createAnnouncement(req.body, req);
    apiSuccess(res, result.announcement, {
      status: 201,
      extra: { ...result },
    });
  }));

  router.get('/announcements/:id', asyncRoute(async (req, res) => {
    const announcement = await getAnnouncement(req.params.id);
    if (!announcement) {
      throw createApiError('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found', 404);
    }
    apiSuccess(res, announcement, { extra: { announcement } });
  }));

  router.post('/announcements/:id/send', asyncRoute(async (req, res) => {
    const result = await sendAnnouncementById(req.params.id, req);
    const announcement = await getAnnouncement(req.params.id);
    apiSuccess(res, result, { extra: { result, announcement } });
  }));

  router.get('/settings/welcome', asyncRoute(async (req, res) => {
    const settings = await getSetting('welcome', DEFAULT_WELCOME_SETTINGS);
    apiSuccess(res, settings, { extra: { settings } });
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
    apiSuccess(res, settings, { extra: { settings } });
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
    const embed = buildWelcomeEmbed(fakeMember, settings, settings.description || DEFAULT_WELCOME_SETTINGS.description);
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
    apiSuccess(res, { sent: Boolean(message), messageId: message?.id || null }, {
      extra: { sent: Boolean(message), messageId: message?.id || null },
    });
  }));

  router.get('/settings/youtube', asyncRoute(async (req, res) => {
    const settings = await getSetting('youtube', DEFAULT_YOUTUBE_SETTINGS);
    apiSuccess(res, settings, { extra: { settings } });
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
    apiSuccess(res, settings, { extra: { settings } });
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
      const msg = await sendToChannelId(channelId, { embed, components: [buildWebsiteButtonRow({ label: 'Watch video', url: req.body.link || 'https://youtube.com' })] }, YT_REACTIONS);
      posts.push({ channelId, messageId: msg.id });
    }
    await logActivity({ type: 'youtube', action: 'test', actor: getActor(req), source: 'crm_api', metadata: { posts } });
    apiSuccess(res, posts, { total: posts.length, extra: { sent: posts.length > 0, posts } });
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
    apiSuccess(res, result.rows, { total: result.rows.length, extra: { history: result.rows } });
  }));

  router.get('/settings', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT key, value, group_key, created_at, updated_at FROM discord_settings ORDER BY group_key ASC, key ASC`
    );
    const settings = result.rows.map(row => ({
      key: row.key,
      value: row.value,
      group: row.group_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    apiSuccess(res, settings, { total: settings.length, extra: { settings } });
  }));

  router.get('/settings/group/:groupKey', asyncRoute(async (req, res) => {
    const settings = await getSettingsByGroup(req.params.groupKey);
    apiSuccess(res, settings, { total: settings.length, extra: { settings } });
  }));

  router.patch('/settings', asyncRoute(async (req, res) => {
    const groupKey = req.body.group || 'general';
    const settings = await setSettings(req.body.settings || {}, groupKey);
    await logActivity({ type: 'settings', action: 'bulk_updated', actor: getActor(req), source: 'crm_api', metadata: { groupKey, keys: Object.keys(settings) } });
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.delete('/settings/:key', asyncRoute(async (req, res) => {
    const deleted = await deleteSetting(req.params.key);
    await logActivity({ type: 'settings', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'setting', entityId: req.params.key });
    apiSuccess(res, { deleted }, { extra: { deleted } });
  }));

  router.get('/channel-mappings', asyncRoute(async (req, res) => {
    const mappings = await getChannelMappings();
    apiSuccess(res, mappings, { extra: { mappings } });
  }));

  router.patch('/channel-mappings', asyncRoute(async (req, res) => {
    const actor = getActor(req);
    const patch = req.body.mappings || req.body;
    const updated = {};

    for (const [key, value] of Object.entries(patch)) {
      if (!CHANNEL_MAPPING_KEYS.includes(key)) continue;
      const channelId = value ? requireDiscordId(value, `${key} channel ID`) : null;
      if (channelId) {
        const channel = await fetchTextChannel(channelId);
        const permissions = client.user ? channel.permissionsFor(client.user) : null;
        if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
          throw createApiError('CHANNEL_PERMISSION_MISSING', `Bot cannot send messages in ${channel.name}`, 400);
        }
      }
      await pool.query(
        `
        INSERT INTO discord_channel_mappings (key, channel_id, updated_by, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (key)
        DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        `,
        [key, channelId, actor]
      );
      updated[key] = channelId;
    }

    await setSetting('channel_mappings', await getChannelMappings(), 'mappings');
    await logActivity({ type: 'mapping', action: 'channels_updated', actor, source: 'crm_api', metadata: updated });
    const mappings = await getChannelMappings();
    apiSuccess(res, mappings, { extra: { mappings } });
  }));

  router.get('/role-mappings', asyncRoute(async (req, res) => {
    const mappings = await getRoleMappings();
    apiSuccess(res, mappings, { extra: { mappings } });
  }));

  router.patch('/role-mappings', asyncRoute(async (req, res) => {
    const actor = getActor(req);
    const patch = req.body.mappings || req.body;
    const updated = {};

    for (const [key, value] of Object.entries(patch)) {
      if (!ROLE_MAPPING_KEYS.includes(key)) continue;
      const roleId = value ? requireDiscordId(value, `${key} role ID`) : null;
      if (roleId) {
        const guild = await getGuild();
        if (guild) {
          const role = await guild.roles.fetch(roleId).catch(() => null);
          if (!role) {
            throw createApiError('ROLE_NOT_FOUND', `Role mapping ${key} does not exist in Discord`, 400);
          }
        }
      }
      await pool.query(
        `
        INSERT INTO discord_role_mappings (key, role_id, updated_by, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (key)
        DO UPDATE SET role_id = EXCLUDED.role_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        `,
        [key, roleId, actor]
      );
      updated[key] = roleId;
    }

    await setSetting('role_mappings', await getRoleMappings(), 'mappings');
    await logActivity({ type: 'mapping', action: 'roles_updated', actor, source: 'crm_api', metadata: updated });
    const mappings = await getRoleMappings();
    apiSuccess(res, mappings, { extra: { mappings } });
  }));

  router.get('/secrets', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_secret_settings ORDER BY key ASC`);
    const existing = new Map(result.rows.map(row => [row.key, serializeSecret(row)]));
    const secrets = Object.keys(SECRET_DEFINITIONS).map(key => existing.get(key) || {
      key,
      label: SECRET_DEFINITIONS[key].label,
      configured: false,
      lastFour: null,
      requiresRestart: SECRET_DEFINITIONS[key].requiresRestart,
      updatedBy: null,
      createdAt: null,
      updatedAt: null,
    });
    apiSuccess(res, secrets, { total: secrets.length, extra: { secrets } });
  }));

  router.post('/secrets', asyncRoute(async (req, res) => {
    const secretKey = String(req.body.key || '').trim();
    req.params.key = secretKey;
    req.body.value = req.body.value;
    if (!secretKey) throw createApiError('SECRET_KEY_REQUIRED', 'Secret key is required', 400);
    if (!req.body.value) throw createApiError('SECRET_VALUE_REQUIRED', 'Secret value is required', 400);

    const encrypted = encryptSecretValue(req.body.value);
    const definition = getSecretDefinition(secretKey);
    const result = await pool.query(
      `
      INSERT INTO discord_secret_settings
        (key, encrypted_value, iv, auth_tag, last_four, configured, requires_restart, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, $6, $7, NOW())
      ON CONFLICT (key)
      DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                    iv = EXCLUDED.iv,
                    auth_tag = EXCLUDED.auth_tag,
                    last_four = EXCLUDED.last_four,
                    configured = true,
                    requires_restart = EXCLUDED.requires_restart,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()
      RETURNING *
      `,
      [
        secretKey,
        encrypted.encryptedValue,
        encrypted.iv,
        encrypted.authTag,
        encrypted.lastFour,
        definition.requiresRestart,
        getActor(req),
      ]
    );
    await logActivity({ type: 'secret', action: 'upserted', actor: getActor(req), source: 'crm_api', entityType: 'secret', entityId: secretKey, metadata: { requiresRestart: definition.requiresRestart } });
    const secret = serializeSecret(result.rows[0]);
    apiSuccess(res, secret, { status: 201, extra: { secret } });
  }));

  router.put('/secrets/:key', asyncRoute(async (req, res) => {
    const secretKey = String(req.params.key || '').trim();
    const value = req.body.value;
    if (!secretKey) throw createApiError('SECRET_KEY_REQUIRED', 'Secret key is required', 400);
    if (!value) throw createApiError('SECRET_VALUE_REQUIRED', 'Secret value is required', 400);

    const encrypted = encryptSecretValue(value);
    const definition = getSecretDefinition(secretKey);
    const result = await pool.query(
      `
      INSERT INTO discord_secret_settings
        (key, encrypted_value, iv, auth_tag, last_four, configured, requires_restart, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, $6, $7, NOW())
      ON CONFLICT (key)
      DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                    iv = EXCLUDED.iv,
                    auth_tag = EXCLUDED.auth_tag,
                    last_four = EXCLUDED.last_four,
                    configured = true,
                    requires_restart = EXCLUDED.requires_restart,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()
      RETURNING *
      `,
      [
        secretKey,
        encrypted.encryptedValue,
        encrypted.iv,
        encrypted.authTag,
        encrypted.lastFour,
        definition.requiresRestart,
        getActor(req),
      ]
    );
    await logActivity({ type: 'secret', action: 'upserted', actor: getActor(req), source: 'crm_api', entityType: 'secret', entityId: secretKey, metadata: { requiresRestart: definition.requiresRestart } });
    const secret = serializeSecret(result.rows[0]);
    apiSuccess(res, secret, { extra: { secret } });
  }));

  router.delete('/secrets/:key', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `
      UPDATE discord_secret_settings
      SET encrypted_value = NULL,
          iv = NULL,
          auth_tag = NULL,
          last_four = NULL,
          configured = false,
          updated_by = $2,
          updated_at = NOW()
      WHERE key = $1
      RETURNING *
      `,
      [req.params.key, getActor(req)]
    );
    await logActivity({ type: 'secret', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'secret', entityId: req.params.key });
    apiSuccess(res, result.rowCount ? serializeSecret(result.rows[0]) : { key: req.params.key, configured: false });
  }));

  router.post('/secrets/:key/test', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM discord_secret_settings WHERE key = $1`,
      [req.params.key]
    );
    const configured = result.rowCount ? Boolean(result.rows[0].configured) : false;
    apiSuccess(res, { key: req.params.key, configured, decryptable: configured && Boolean(getEncryptionKey()) });
  }));

  router.get('/auto-reactions', asyncRoute(async (req, res) => {
    const rules = await listAutoReactionRules();
    apiSuccess(res, rules, { total: rules.length, extra: { rules } });
  }));

  router.post('/auto-reactions', asyncRoute(async (req, res) => {
    const payload = normalizeAutoReactionPayload(req.body);
    const rule = await saveAutoReactionRule(payload);
    await logActivity({ type: 'auto_reaction', action: 'created', actor: getActor(req), source: 'crm_api', entityType: 'auto_reaction_rule', entityId: String(rule.id) });
    apiSuccess(res, rule, { status: 201, extra: { rule } });
  }));

  router.get('/auto-reactions/:id', asyncRoute(async (req, res) => {
    const rule = await getAutoReactionRule(req.params.id);
    if (!rule) throw createApiError('AUTO_REACTION_NOT_FOUND', 'Auto-reaction rule not found', 404);
    apiSuccess(res, rule, { extra: { rule } });
  }));

  router.patch('/auto-reactions/:id', asyncRoute(async (req, res) => {
    const existing = await getAutoReactionRule(req.params.id);
    if (!existing) throw createApiError('AUTO_REACTION_NOT_FOUND', 'Auto-reaction rule not found', 404);
    const payload = normalizeAutoReactionPayload(req.body, existing);
    const rule = await saveAutoReactionRule(payload, req.params.id);
    await logActivity({ type: 'auto_reaction', action: 'updated', actor: getActor(req), source: 'crm_api', entityType: 'auto_reaction_rule', entityId: String(rule.id) });
    apiSuccess(res, rule, { extra: { rule } });
  }));

  router.delete('/auto-reactions/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_auto_reaction_rules WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'auto_reaction', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'auto_reaction_rule', entityId: String(req.params.id) });
    apiSuccess(res, { deleted: result.rowCount > 0 }, { extra: { deleted: result.rowCount > 0 } });
  }));

  router.post('/auto-reactions/:id/test', asyncRoute(async (req, res) => {
    const rule = await getAutoReactionRule(req.params.id);
    if (!rule) throw createApiError('AUTO_REACTION_NOT_FOUND', 'Auto-reaction rule not found', 404);
    const channelId = req.body.channelId ? requireDiscordId(req.body.channelId, 'Channel ID') : rule.channels[0];
    if (!channelId) throw createApiError('CHANNEL_REQUIRED', 'A channel ID is required for test', 400);
    const channel = await fetchTextChannel(channelId);
    const message = await channel.send({
      content: 'Auto-reaction test',
      allowedMentions: { parse: [] },
    });
    await addReactions(message, rule.reactions);
    await logActivity({ type: 'auto_reaction', action: 'test', actor: getActor(req), source: 'crm_api', entityType: 'auto_reaction_rule', entityId: String(rule.id), metadata: { channelId, messageId: message.id } });
    apiSuccess(res, { channelId, messageId: message.id, reactions: rule.reactions });
  }));

  router.get('/templates', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit || req.query.pageSize, 100, 200);
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM discord_templates ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_templates`);
    apiSuccess(res, result.rows, {
      page,
      pageSize: limit,
      total: countResult.rows[0]?.count || 0,
      extra: { templates: result.rows },
    });
  }));

  router.post('/templates', asyncRoute(async (req, res) => {
    const type = String(req.body.type || '').toUpperCase();
    if (!TEMPLATE_TYPES.has(type)) {
      throw createApiError('INVALID_TEMPLATE_TYPE', 'Invalid template type', 400);
    }
    const name = String(req.body.name || '').trim();
    if (!name) throw createApiError('TEMPLATE_NAME_REQUIRED', 'Template name is required', 400);
    const result = await pool.query(
      `
      INSERT INTO discord_templates (type, name, content)
      VALUES ($1, $2, $3::jsonb)
      RETURNING *
      `,
      [type, name, JSON.stringify(req.body.content || {})]
    );
    await logActivity({ type: 'template', action: 'created', actor: getActor(req), source: 'crm_api', entityType: 'template', entityId: String(result.rows[0].id) });
    apiSuccess(res, result.rows[0], { status: 201, extra: { template: result.rows[0] } });
  }));

  router.get('/templates/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_templates WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('TEMPLATE_NOT_FOUND', 'Template not found', 404);
    apiSuccess(res, result.rows[0], { extra: { template: result.rows[0] } });
  }));

  router.patch('/templates/:id', asyncRoute(async (req, res) => {
    const current = await pool.query(`SELECT * FROM discord_templates WHERE id = $1`, [req.params.id]);
    if (!current.rowCount) throw createApiError('TEMPLATE_NOT_FOUND', 'Template not found', 404);
    const next = {
      type: req.body.type ? String(req.body.type).toUpperCase() : current.rows[0].type,
      name: req.body.name || current.rows[0].name,
      content: req.body.content || current.rows[0].content,
    };
    if (!TEMPLATE_TYPES.has(next.type)) throw createApiError('INVALID_TEMPLATE_TYPE', 'Invalid template type', 400);
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
    apiSuccess(res, result.rows[0], { extra: { template: result.rows[0] } });
  }));

  router.delete('/templates/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_templates WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'template', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'template', entityId: String(req.params.id) });
    apiSuccess(res, { deleted: result.rowCount > 0 }, { extra: { deleted: result.rowCount > 0 } });
  }));

  router.get('/managed-posts', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM discord_managed_posts ORDER BY display_order ASC, updated_at DESC`
    );
    const rows = result.rows.map(serializeManagedPost);
    apiSuccess(res, rows, { total: rows.length, extra: { managedPosts: rows } });
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
    const managedPost = serializeManagedPost(result.rows[0]);
    apiSuccess(res, managedPost, { status: 201, extra: { managedPost } });
  }));

  router.get('/managed-posts/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('MANAGED_POST_NOT_FOUND', 'Managed post not found', 404);
    const managedPost = serializeManagedPost(result.rows[0]);
    apiSuccess(res, managedPost, { extra: { managedPost } });
  }));

  router.patch('/managed-posts/:id', asyncRoute(async (req, res) => {
    const current = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!current.rowCount) throw createApiError('MANAGED_POST_NOT_FOUND', 'Managed post not found', 404);
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
    const managedPost = serializeManagedPost(result.rows[0]);
    apiSuccess(res, managedPost, { extra: { managedPost } });
  }));

  router.post('/managed-posts/:id/publish', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('MANAGED_POST_NOT_FOUND', 'Managed post not found', 404);
    const managedPost = result.rows[0];
    const hasIncomingDraft = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
    const payload = hasIncomingDraft
      ? normalizeManagedPayload({
        ...(managedPost.payload || {}),
        ...req.body,
        channelId: req.body.channelId || managedPost.channel_id,
        messageId: managedPost.message_id,
        internalName: req.body.internalName || managedPost.internal_name,
      })
      : (managedPost.payload || {});
    const targetChannelId = payload.channelId || managedPost.channel_id;
    const targetMessageId = targetChannelId === managedPost.channel_id
      ? managedPost.message_id
      : null;
    const description = managedDescriptionFromPayload(payload);
    const buttons = managedButtonsFromPayload(payload);

    try {
      const message = await editOrCreateManagedMessage({
        channelId: targetChannelId,
        messageId: targetMessageId,
        payload: {
          title: payload.title || managedPost.internal_name,
          description,
          content: payload.content || '',
          fields: payload.fields || [],
          imageUrl: payload.imageUrl || null,
          thumbnail: payload.thumbnail || null,
          footer: payload.footer || BRAND_FOOTER,
          embedColor: payload.embedColor || BRAND_COLOR,
          buttons,
          components: buildButtonRows(buttons),
          pingEveryone: false,
        },
        reactions: payload.reactions || DEFAULT_MANAGED_REACTIONS,
      });
      payload.channelId = targetChannelId;
      payload.messageId = message.id;

      const updateResult = await pool.query(
        `
        UPDATE discord_managed_posts
        SET message_id = $2,
            status = 'published',
            payload = $3::jsonb,
            channel_id = $4,
            internal_name = $5,
            display_order = $6,
            last_error = NULL,
            updated_at = NOW(),
            published_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [
          req.params.id,
          message.id,
          JSON.stringify(payload),
          targetChannelId,
          payload.internalName || managedPost.internal_name,
          payload.displayOrder || managedPost.display_order || 0,
        ]
      );
      await logActivity({ type: 'managed_post', action: 'published', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id), metadata: { messageId: message.id } });
      const updated = serializeManagedPost(updateResult.rows[0]);
      apiSuccess(res, updated, { extra: { managedPost: updated } });
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
    if (!result.rowCount) throw createApiError('MANAGED_POST_NOT_FOUND', 'Managed post not found', 404);
    const managedPost = result.rows[0];
    if (!managedPost.message_id) throw createApiError('MANAGED_POST_UNPUBLISHED', 'Managed post has no Discord message ID', 400);
    const channel = await fetchTextChannel(managedPost.channel_id);
    const message = await channel.messages.fetch(managedPost.message_id);
    await addReactions(message, sanitizeReactions(managedPost.payload?.reactions, DEFAULT_MANAGED_REACTIONS).slice(0, 10));
    await logActivity({ type: 'managed_post', action: 'reaction_sync', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id) });
    apiSuccess(res, { synced: true }, { extra: { synced: true } });
  }));

  router.delete('/managed-posts/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'managed_post', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id) });
    apiSuccess(res, { deleted: result.rowCount > 0 }, { extra: { deleted: result.rowCount > 0 } });
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
    const rows = result.rows.map(serializeActivityLog);
    apiSuccess(res, rows, { total: rows.length, extra: { activity: rows } });
  }));

  router.get('/dm-campaigns', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM discord_dm_campaigns ORDER BY created_at DESC LIMIT $1`,
      [parsePositiveInt(req.query.limit, 100, 500)]
    );
    apiSuccess(res, result.rows, { total: result.rows.length, extra: { dmCampaigns: result.rows } });
  }));

  router.get('/dm-campaigns/:id', asyncRoute(async (req, res) => {
    const campaign = await pool.query(`SELECT * FROM discord_dm_campaigns WHERE id = $1`, [req.params.id]);
    if (!campaign.rowCount) throw createApiError('DM_CAMPAIGN_NOT_FOUND', 'DM campaign not found', 404);
    const deliveries = await pool.query(
      `SELECT * FROM discord_dm_deliveries WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    apiSuccess(res, {
      dmCampaign: campaign.rows[0],
      deliveries: deliveries.rows,
    }, {
      extra: { dmCampaign: campaign.rows[0], deliveries: deliveries.rows },
    });
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
