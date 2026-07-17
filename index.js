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
let subscriberHydrationRunning = false;

const BRAND_COLOR = 0xf35023;
const BRAND_NAME = 'TTT Markets';
const BRAND_FOOTER = 'TTT Markets • Official Alerts';
const YT_FOOTER = 'TTT Markets • YouTube Alerts';
const LOGO_URL =
  'https://tttmarkets.com/wp-content/uploads/2025/09/cropped-TTT-Logo.png';
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://tttmarkets.com';
const AUTO_POST_SHORTS =
  String(process.env.AUTO_POST_SHORTS || 'true').toLowerCase() !== 'false';
const YOUTUBE_ADVISORY_LOCK_KEY = 4771029783;

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
  ZEALY_API_KEY: { label: 'Zealy API key', requiresRestart: false },
  ZEALY_COMMUNITY_SUBDOMAIN: { label: 'Zealy community subdomain', requiresRestart: false },
  ZEALY_WEBHOOK_SECRET: { label: 'Zealy webhook secret', requiresRestart: false },
  ZEALY_API_BASE_URL: { label: 'Zealy API base URL override', requiresRestart: false },
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

const NEWS_PROVIDER = 'FOREX_FACTORY';
const DEFAULT_NEWS_FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const DEFAULT_NEWS_CURRENCIES = ['USD', 'GBP', 'EUR', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'];
const OPTIONAL_NEWS_CURRENCIES = ['CNY'];
const NEWS_IMPACTS = new Set(['HIGH', 'MEDIUM', 'LOW', 'HOLIDAY', 'NON_ECONOMIC', 'TENTATIVE']);
const NEWS_ADVANCE_ALERT_TYPES = {
  HIGH: 'HIGH_IMPACT_ADVANCE',
  MEDIUM: 'MEDIUM_IMPACT_ADVANCE',
  LOW: 'LOW_IMPACT_ADVANCE',
};
const NEWS_ALERT_STATUSES = new Set(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED']);
const NEWS_TEMPLATE_TYPES = new Set([
  'DAILY_SUMMARY',
  'HIGH_IMPACT_ADVANCE',
  'MEDIUM_IMPACT_ADVANCE',
  'LOW_IMPACT_ADVANCE',
  'EVENT_TIME',
  'CUSTOM',
]);
const NEWS_TEMPLATE_VARIABLES = [
  'title',
  'currency',
  'country',
  'impact',
  'scheduled_at',
  'uk_time',
  'discord_time_full',
  'discord_time_relative',
  'forecast',
  'previous',
  'actual',
  'forecast_or_na',
  'previous_or_na',
  'actual_or_na',
  'minutes_before',
  'event_url',
  'event_list',
  'event_count',
  'date',
];
const NEWS_FETCH_TIMEOUT_MS = Number(process.env.DISCORD_NEWS_FETCH_TIMEOUT_MS || 12000);
const NEWS_ALERT_POLL_MS = Number(process.env.DISCORD_NEWS_ALERT_POLL_MS || 60 * 1000);
const NEWS_STALE_ALERT_GRACE_MINUTES = Number(process.env.DISCORD_NEWS_STALE_ALERT_GRACE_MINUTES || 30);
const NEWS_USER_AGENT = process.env.DISCORD_NEWS_USER_AGENT || 'TTT-Markets-Discord-Bot/1.0 (+https://tttmarkets.com)';
const DEFAULT_NEWS_REACTIONS = ['📊', '⚡', '👀'];
const DEFAULT_NEWS_SETTINGS = {
  enabled: false,
  provider: NEWS_PROVIDER,
  feedUrl: DEFAULT_NEWS_FEED_URL,
  destinationChannelId: process.env.DISCORD_NEWS_CHANNEL_ID || process.env.ANNOUNCEMENTS_CHANNEL_ID || null,
  timezone: 'Europe/London',
  refreshIntervalMinutes: 15,
  selectedCurrencies: DEFAULT_NEWS_CURRENCIES,
  includeHighImpact: true,
  includeMediumImpact: true,
  includeLowImpact: false,
  includeHolidays: false,
  includeTentative: false,
  dailySummaryEnabled: false,
  dailySummaryTime: '07:00',
  dailySummaryMentionEveryone: false,
  highImpactAlertEnabled: true,
  highImpactMinutesBefore: 15,
  highImpactMentionEveryone: false,
  mediumImpactAlertEnabled: false,
  mediumImpactMinutesBefore: 15,
  mediumImpactMentionEveryone: false,
  lowImpactAlertEnabled: false,
  lowImpactMinutesBefore: 15,
  lowImpactMentionEveryone: false,
  defaultReactions: DEFAULT_NEWS_REACTIONS,
  highImpactTemplateId: null,
  mediumImpactTemplateId: null,
  lowImpactTemplateId: null,
  dailySummaryTemplateId: null,
  eventTimeTemplateId: null,
};

const DEFAULT_NEWS_TEMPLATES = [
  {
    name: 'High Impact Advance Alert',
    templateType: 'HIGH_IMPACT_ADVANCE',
    titleTemplate: '🔴 HIGH-IMPACT NEWS IN {{minutes_before}} MINUTES',
    bodyTemplate:
      '**{{currency}} — {{title}}**\n\n' +
      '🕒 **Scheduled:** {{discord_time_full}}\n' +
      '⏳ **Starts:** {{discord_time_relative}}\n' +
      '📊 **Forecast:** {{forecast_or_na}}\n' +
      '📉 **Previous:** {{previous_or_na}}\n\n' +
      'Significant market volatility may occur before, during and after this economic release.',
    colour: '#dc2626',
    reactions: DEFAULT_NEWS_REACTIONS,
  },
  {
    name: 'Medium Impact Advance Alert',
    templateType: 'MEDIUM_IMPACT_ADVANCE',
    titleTemplate: '🟠 MEDIUM-IMPACT NEWS IN {{minutes_before}} MINUTES',
    bodyTemplate:
      '**{{currency}} — {{title}}**\n\n' +
      '🕒 **Scheduled:** {{discord_time_full}}\n' +
      '⏳ **Starts:** {{discord_time_relative}}\n' +
      '📊 **Forecast:** {{forecast_or_na}}\n' +
      '📉 **Previous:** {{previous_or_na}}\n\n' +
      'Please be aware that market activity may increase around this economic release.',
    colour: '#f97316',
    reactions: DEFAULT_NEWS_REACTIONS,
  },
  {
    name: 'Low Impact Advance Alert',
    templateType: 'LOW_IMPACT_ADVANCE',
    titleTemplate: '🟡 ECONOMIC NEWS IN {{minutes_before}} MINUTES',
    bodyTemplate:
      '**{{currency}} — {{title}}**\n\n' +
      '🕒 **Scheduled:** {{discord_time_full}}\n' +
      '📊 **Forecast:** {{forecast_or_na}}\n' +
      '📉 **Previous:** {{previous_or_na}}',
    colour: '#eab308',
    reactions: DEFAULT_NEWS_REACTIONS,
  },
  {
    name: 'Daily Economic News Summary',
    templateType: 'DAILY_SUMMARY',
    titleTemplate: "📅 TODAY'S ECONOMIC NEWS",
    bodyTemplate:
      'The following selected economic events are scheduled today:\n\n' +
      '{{event_list}}\n\n' +
      'Times are shown using Discord local timestamps.',
    colour: '#f35023',
    reactions: DEFAULT_NEWS_REACTIONS,
  },
  {
    name: 'Economic Event Starting Now',
    templateType: 'EVENT_TIME',
    titleTemplate: '🚨 ECONOMIC NEWS EVENT',
    bodyTemplate:
      '**{{currency}} — {{title}}**\n\n' +
      'This event is scheduled now.\n\n' +
      '📊 **Forecast:** {{forecast_or_na}}\n' +
      '📉 **Previous:** {{previous_or_na}}',
    colour: '#f35023',
    reactions: DEFAULT_NEWS_REACTIONS,
  },
];

let newsRefreshIntervalHandle = null;
let newsAlertIntervalHandle = null;
let newsSyncRunning = false;
let newsAlertPollRunning = false;

let zealyLeaderboardIntervalHandle = null;
let zealyRewardIntervalHandle = null;
let zealyLeaderboardRunning = false;
let zealyRewardRunning = false;
let lastZealyLeaderboardPublishAt = 0;
let lastZealyRewardPollAt = 0;
const ZEALY_DEFAULT_API_BASE_URL = 'https://api-v2.zealy.io';
const ZEALY_FETCH_TIMEOUT_MS = Number(process.env.ZEALY_FETCH_TIMEOUT_MS || 12000);
const ZEALY_USER_AGENT = process.env.ZEALY_USER_AGENT || 'TTT-Markets-Discord-Bot/1.0 (+https://tttmarkets.com)';
const ZEALY_TEMPLATE_VARIABLES = [
  'zealy_name',
  'discord_name',
  'user_display',
  'quest_name',
  'quest_type',
  'xp_delta',
  'formatted_xp_delta',
  'current_xp',
  'rank',
  'previous_rank',
  'rank_change',
  'reward_name',
  'reward_name_or_default',
  'milestone',
  'sprint_name',
  'community_name',
  'discord_time',
  'zealy_url',
];
const ZEALY_EVENT_TYPES = [
  'QUEST_COMPLETED',
  'DAILY_QUEST_COMPLETED',
  'WEEKLY_QUEST_COMPLETED',
  'GENERAL_QUEST_COMPLETED',
  'XP_EARNED',
  'XP_DEDUCTED',
  'SHOP_REWARD_REDEMPTION',
  'MILESTONE_REACHED',
  'LEADERBOARD_TOP_10_ENTRY',
  'LEADERBOARD_TOP_3_ENTRY',
  'RANK_IMPROVEMENT',
  'SPRINT_QUEST_COMPLETED',
  'SPRINT_MILESTONE',
  'NEW_MEMBER_JOINED',
];
const ZEALY_DEFAULT_ENABLED_EVENTS = [
  'QUEST_COMPLETED',
  'DAILY_QUEST_COMPLETED',
  'WEEKLY_QUEST_COMPLETED',
  'GENERAL_QUEST_COMPLETED',
  'XP_EARNED',
  'XP_DEDUCTED',
  'SHOP_REWARD_REDEMPTION',
  'MILESTONE_REACHED',
  'LEADERBOARD_TOP_10_ENTRY',
  'LEADERBOARD_TOP_3_ENTRY',
];
const ZEALY_DEFAULT_MILESTONES = [100, 250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
const ZEALY_DEFAULT_SETTINGS = {
  enabled: false,
  leaderboardEnabled: false,
  leaderboardChannelId: null,
  leaderboardScope: 'ALL_TIME',
  leaderboardLimit: 10,
  leaderboardRefreshMinutes: 10,
  leaderboardMessageId: null,
  leaderboardIncludeSprint: true,
  leaderboardShowXp: true,
  leaderboardShowRank: true,
  leaderboardShowDiscordNames: true,
  leaderboardShowStats: true,
  rewardFeedEnabled: false,
  rewardFeedChannelId: null,
  rewardFeedPollMinutes: 5,
  rewardFeedEventToggles: Object.fromEntries(ZEALY_EVENT_TYPES.map(type => [type, ZEALY_DEFAULT_ENABLED_EVENTS.includes(type)])),
  rewardFeedMilestones: ZEALY_DEFAULT_MILESTONES,
  rewardFeedMilestoneMode: 'HIGHEST_ONLY',
};
const ZEALY_DEFAULT_TEMPLATES = [
  { name: 'Quest Complete', eventType: 'QUEST_COMPLETED', titleTemplate: '🎉 Quest Complete!', bodyTemplate: '**{{user_display}}** completed:\n\n**{{quest_name}}**\n\n⭐ **+{{xp_delta}} XP**\n\nKeep climbing the TTT Markets leaderboard!' },
  { name: 'Daily Quest Completed', eventType: 'DAILY_QUEST_COMPLETED', titleTemplate: '🔥 Daily Quest Completed', bodyTemplate: '**{{user_display}}** completed:\n\n**{{quest_name}}**\n\n⭐ **+{{xp_delta}} XP**' },
  { name: 'Weekly Quest Completed', eventType: 'WEEKLY_QUEST_COMPLETED', titleTemplate: '🚀 Weekly Quest Completed', bodyTemplate: '**{{user_display}}** completed:\n\n**{{quest_name}}**\n\n⭐ **+{{xp_delta}} XP**' },
  { name: 'XP Earned', eventType: 'XP_EARNED', titleTemplate: '⭐ XP Earned', bodyTemplate: '**{{user_display}}** earned **+{{xp_delta}} XP**\n\nCurrent balance: **{{current_xp}} XP**' },
  { name: 'XP Reward Claimed', eventType: 'XP_DEDUCTED', titleTemplate: '🛒 XP Reward Claimed', bodyTemplate: '**{{user_display}}** spent **{{formatted_xp_delta}} XP**\n\n{{reward_name_or_default}}\n\nCurrent balance: **{{current_xp}} XP**' },
  { name: 'Milestone Achieved', eventType: 'MILESTONE_REACHED', titleTemplate: '🏅 Milestone Achieved', bodyTemplate: 'Congratulations **{{user_display}}**!\n\nYou have reached **{{milestone}} XP**.' },
  { name: 'Leaderboard Top 10', eventType: 'LEADERBOARD_TOP_10_ENTRY', titleTemplate: '📈 Leaderboard Update', bodyTemplate: '**{{user_display}}** has entered the **Top 10**!\n\nCurrent rank: **#{{rank}}**\nCurrent XP: **{{current_xp}}**' },
  { name: 'Podium Alert', eventType: 'LEADERBOARD_TOP_3_ENTRY', titleTemplate: '🏆 Podium Alert', bodyTemplate: '**{{user_display}}** has reached **#{{rank}}** on the TTT Markets leaderboard!\n\n⭐ **{{current_xp}} XP**' },
  { name: 'New Zealy Member', eventType: 'NEW_MEMBER_JOINED', titleTemplate: '👋 New Zealy Member', bodyTemplate: 'Welcome **{{user_display}}** to the TTT Markets rewards community!\n\nStart completing quests, earning XP and climbing the leaderboard.' },
  { name: 'Shop Reward', eventType: 'SHOP_REWARD_REDEMPTION', titleTemplate: '🛒 Reward Claimed', bodyTemplate: '**{{user_display}}** claimed **{{reward_name}}**.\n\nXP change: **{{formatted_xp_delta}}**' },
  { name: 'Rank Improvement', eventType: 'RANK_IMPROVEMENT', titleTemplate: '📈 Rank Improved', bodyTemplate: '**{{user_display}}** moved from **#{{previous_rank}}** to **#{{rank}}**.\n\nCurrent XP: **{{current_xp}}**' },
];

const PAYOUT_FEED_MODES = new Set(['SIMULATION', 'LIVE', 'DISABLED']);
const PAYOUT_FEED_STATUSES = new Set(['GENERATED', 'SCHEDULED', 'PROCESSING', 'POSTED', 'FAILED', 'SKIPPED', 'CANCELLED']);
const PAYOUT_POSTING_DAYS = ['WEDNESDAY', 'THURSDAY'];
const PAYOUT_FEED_POLL_MS = Number(process.env.DISCORD_PAYOUT_FEED_POLL_MS || 60 * 1000);
const PAYOUT_STALE_GRACE_MINUTES = Number(process.env.DISCORD_PAYOUT_STALE_GRACE_MINUTES || 240);
const DEFAULT_PAYOUT_COUNTRIES = ['GB', 'US', 'IT', 'DE', 'FR', 'ES', 'NL', 'BE', 'PL', 'NG', 'ZA', 'AE', 'IN', 'PK', 'BD', 'MY', 'TH', 'VN', 'JP', 'NZ', 'AU', 'CA', 'CH', 'IE', 'DK', 'SE', 'NO', 'FI', 'BR', 'MX', 'AR'];
const PAYOUT_CURRENCIES = ['USD', 'GBP', 'EUR'];
const DEFAULT_PAYOUT_SETTINGS = {
  mode: 'DISABLED',
  enabled: false,
  destinationChannelId: process.env.DISCORD_PAYOUT_FEED_CHANNEL_ID || process.env.PAYOUT_PROOFS_CHANNEL_ID || null,
  timezone: 'Europe/London',
  postingDays: PAYOUT_POSTING_DAYS,
  postingWindowStart: '10:00',
  postingWindowEnd: '22:00',
  weeklyMinimum: 20,
  weeklyMaximum: 50,
  minimumIntervalMinutes: 10,
  maximumIntervalMinutes: 95,
  randomiseTiming: true,
  simulationEnabled: false,
  simulationNameMode: 'FIRST_INITIAL',
  simulationCurrencyMode: 'DEFAULT',
  simulationMinAmount: 25,
  simulationMaxAmount: 2500,
  simulationDecimalVariation: true,
  simulationSelectedCountries: DEFAULT_PAYOUT_COUNTRIES,
  simulationTemplateRotation: true,
  defaultCurrency: 'USD',
};
const PAYOUT_NAME_POOL = [
  'Alex', 'Daniel', 'Sofia', 'James', 'Marco', 'Amina', 'Liam', 'Elena', 'Maya', 'Noah',
  'Amelia', 'Omar', 'Hiro', 'Priya', 'Fatima', 'Lucas', 'Emma', 'Mateo', 'Zara', 'Leo',
  'Nadia', 'Kai', 'Mila', 'Hassan', 'Chloe', 'Victor', 'Sara', 'Ethan', 'Aisha', 'Theo',
  'Ines', 'Ravi', 'Luca', 'Grace', 'Yusuf', 'Hana', 'Ben', 'Lina', 'Arjun', 'Mia',
];
const PAYOUT_INITIALS = 'ABCDEFGHJKLMNPRSTVWYZ'.split('');
const DEFAULT_PAYOUT_MESSAGE_TEMPLATE = 'An TTT Trader from {{flag_code}} just secured a {{reward_amount}} reward! :moneybag:';
const DEFAULT_PAYOUT_TEMPLATES = [DEFAULT_PAYOUT_MESSAGE_TEMPLATE];
let payoutFeedIntervalHandle = null;
let payoutFeedPollRunning = false;

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
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS display_name TEXT;`);
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_news_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT false,
      provider TEXT NOT NULL DEFAULT 'FOREX_FACTORY',
      feed_url TEXT NOT NULL DEFAULT '${DEFAULT_NEWS_FEED_URL}',
      destination_channel_id TEXT,
      timezone TEXT NOT NULL DEFAULT 'Europe/London',
      refresh_interval_minutes INTEGER NOT NULL DEFAULT 15,
      selected_currencies JSONB NOT NULL DEFAULT '["USD","GBP","EUR","JPY","CAD","AUD","NZD","CHF"]'::jsonb,
      include_high_impact BOOLEAN NOT NULL DEFAULT true,
      include_medium_impact BOOLEAN NOT NULL DEFAULT true,
      include_low_impact BOOLEAN NOT NULL DEFAULT false,
      include_holidays BOOLEAN NOT NULL DEFAULT false,
      include_tentative BOOLEAN NOT NULL DEFAULT false,
      daily_summary_enabled BOOLEAN NOT NULL DEFAULT false,
      daily_summary_time TEXT NOT NULL DEFAULT '07:00',
      daily_summary_mention_everyone BOOLEAN NOT NULL DEFAULT false,
      high_impact_alert_enabled BOOLEAN NOT NULL DEFAULT true,
      high_impact_minutes_before INTEGER NOT NULL DEFAULT 15,
      high_impact_mention_everyone BOOLEAN NOT NULL DEFAULT false,
      medium_impact_alert_enabled BOOLEAN NOT NULL DEFAULT false,
      medium_impact_minutes_before INTEGER NOT NULL DEFAULT 15,
      medium_impact_mention_everyone BOOLEAN NOT NULL DEFAULT false,
      low_impact_alert_enabled BOOLEAN NOT NULL DEFAULT false,
      low_impact_minutes_before INTEGER NOT NULL DEFAULT 15,
      low_impact_mention_everyone BOOLEAN NOT NULL DEFAULT false,
      default_reactions JSONB NOT NULL DEFAULT '["📊","⚡","👀"]'::jsonb,
      high_impact_template_id BIGINT,
      medium_impact_template_id BIGINT,
      low_impact_template_id BIGINT,
      daily_summary_template_id BIGINT,
      event_time_template_id BIGINT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE discord_news_settings ADD COLUMN IF NOT EXISTS high_impact_template_id BIGINT;`);
  await pool.query(`ALTER TABLE discord_news_settings ADD COLUMN IF NOT EXISTS medium_impact_template_id BIGINT;`);
  await pool.query(`ALTER TABLE discord_news_settings ADD COLUMN IF NOT EXISTS low_impact_template_id BIGINT;`);
  await pool.query(`ALTER TABLE discord_news_settings ADD COLUMN IF NOT EXISTS daily_summary_template_id BIGINT;`);
  await pool.query(`ALTER TABLE discord_news_settings ADD COLUMN IF NOT EXISTS event_time_template_id BIGINT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_news_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_key TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      currency TEXT,
      country TEXT,
      impact TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      forecast TEXT,
      previous TEXT,
      actual TEXT,
      source_url TEXT,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cancelled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_news_templates (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      template_type TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      title_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      colour TEXT,
      image_url TEXT,
      thumbnail_url TEXT,
      footer_text TEXT,
      buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
      reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS discord_news_templates_type_name_key
    ON discord_news_templates (template_type, name);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_news_alerts (
      id BIGSERIAL PRIMARY KEY,
      news_event_id BIGINT REFERENCES discord_news_events(id) ON DELETE CASCADE,
      alert_type TEXT NOT NULL,
      scheduled_for TIMESTAMPTZ NOT NULL,
      destination_channel_id TEXT,
      mention_everyone BOOLEAN NOT NULL DEFAULT false,
      template_id BIGINT REFERENCES discord_news_templates(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      discord_message_id TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      sent_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE discord_news_alerts ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES discord_news_templates(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE discord_news_alerts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS discord_news_alerts_dedupe_key
    ON discord_news_alerts (COALESCE(news_event_id, 0), alert_type, COALESCE(destination_channel_id, ''), scheduled_for);
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_news_alerts_due_idx ON discord_news_alerts (status, scheduled_for);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_news_events_schedule_idx ON discord_news_events (scheduled_at, currency, impact);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_news_sync_logs (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      events_received INTEGER NOT NULL DEFAULT 0,
      events_created INTEGER NOT NULL DEFAULT 0,
      events_updated INTEGER NOT NULL DEFAULT 0,
      alerts_created INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_payout_feed_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'DISABLED',
      enabled BOOLEAN NOT NULL DEFAULT false,
      destination_channel_id TEXT,
      timezone TEXT NOT NULL DEFAULT 'Europe/London',
      posting_days JSONB NOT NULL DEFAULT '["WEDNESDAY","THURSDAY"]'::jsonb,
      posting_window_start TEXT NOT NULL DEFAULT '10:00',
      posting_window_end TEXT NOT NULL DEFAULT '22:00',
      weekly_minimum INTEGER NOT NULL DEFAULT 20,
      weekly_maximum INTEGER NOT NULL DEFAULT 50,
      minimum_interval_minutes INTEGER NOT NULL DEFAULT 10,
      maximum_interval_minutes INTEGER NOT NULL DEFAULT 95,
      randomise_timing BOOLEAN NOT NULL DEFAULT true,
      simulation_enabled BOOLEAN NOT NULL DEFAULT false,
      simulation_name_mode TEXT NOT NULL DEFAULT 'FIRST_INITIAL',
      simulation_currency_mode TEXT NOT NULL DEFAULT 'DEFAULT',
      simulation_min_amount NUMERIC(12, 3) NOT NULL DEFAULT 25,
      simulation_max_amount NUMERIC(12, 3) NOT NULL DEFAULT 2500,
      simulation_decimal_variation BOOLEAN NOT NULL DEFAULT true,
      simulation_selected_countries JSONB NOT NULL DEFAULT '["GB","US","IT","DE","FR","ES","NL","BE","PL","NG","ZA","AE","IN","PK","BD","MY","TH","VN","JP","NZ","AU","CA","CH","IE","DK","SE","NO","FI","BR","MX","AR"]'::jsonb,
      simulation_template_rotation BOOLEAN NOT NULL DEFAULT true,
      default_currency TEXT NOT NULL DEFAULT 'USD',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_payout_feed_templates (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      weight INTEGER NOT NULL DEFAULT 1,
      body_template TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'SIMULATION',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS discord_payout_feed_templates_name_source_key
    ON discord_payout_feed_templates (name, source_type);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_payout_feed_weeks (
      id BIGSERIAL PRIMARY KEY,
      mode TEXT NOT NULL,
      week_start TIMESTAMPTZ NOT NULL,
      week_end TIMESTAMPTZ NOT NULL,
      weekly_target INTEGER NOT NULL,
      wednesday_target INTEGER NOT NULL DEFAULT 0,
      thursday_target INTEGER NOT NULL DEFAULT 0,
      generated_count INTEGER NOT NULL DEFAULT 0,
      scheduled_count INTEGER NOT NULL DEFAULT 0,
      posted_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      random_seed_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS discord_payout_feed_weeks_mode_week_key
    ON discord_payout_feed_weeks (mode, week_start);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_payout_feed_items (
      id BIGSERIAL PRIMARY KEY,
      source_type TEXT NOT NULL,
      is_simulated BOOLEAN NOT NULL DEFAULT false,
      external_payout_id TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      display_name TEXT,
      country_code TEXT,
      country_name TEXT,
      flag TEXT,
      amount NUMERIC(12, 3) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'GENERATED',
      scheduled_for TIMESTAMPTZ,
      discord_message_id TEXT,
      posted_at TIMESTAMPTZ,
      template_id BIGINT REFERENCES discord_payout_feed_templates(id) ON DELETE SET NULL,
      week_id BIGINT REFERENCES discord_payout_feed_weeks(id) ON DELETE SET NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE discord_payout_feed_items ADD COLUMN IF NOT EXISTS week_id BIGINT REFERENCES discord_payout_feed_weeks(id) ON DELETE SET NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_payout_feed_items_due_idx ON discord_payout_feed_items (status, scheduled_for);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_payout_feed_items_week_idx ON discord_payout_feed_items (week_id, status);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_certificate_feed_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      pass_channel_id TEXT,
      payout_channel_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
  `);

  await pool.query(`
    INSERT INTO discord_certificate_feed_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_zealy_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT false,
      community_subdomain TEXT,
      leaderboard_enabled BOOLEAN NOT NULL DEFAULT false,
      leaderboard_channel_id TEXT,
      leaderboard_scope TEXT NOT NULL DEFAULT 'ALL_TIME',
      leaderboard_limit INTEGER NOT NULL DEFAULT 10,
      leaderboard_refresh_minutes INTEGER NOT NULL DEFAULT 10,
      leaderboard_message_id TEXT,
      leaderboard_include_sprint BOOLEAN NOT NULL DEFAULT true,
      leaderboard_show_xp BOOLEAN NOT NULL DEFAULT true,
      leaderboard_show_rank BOOLEAN NOT NULL DEFAULT true,
      leaderboard_show_discord_names BOOLEAN NOT NULL DEFAULT true,
      leaderboard_show_stats BOOLEAN NOT NULL DEFAULT true,
      reward_feed_enabled BOOLEAN NOT NULL DEFAULT false,
      reward_feed_channel_id TEXT,
      reward_feed_poll_minutes INTEGER NOT NULL DEFAULT 5,
      reward_feed_event_toggles JSONB NOT NULL DEFAULT '{}'::jsonb,
      reward_feed_milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
      reward_feed_milestone_mode TEXT NOT NULL DEFAULT 'HIGHEST_ONLY',
      last_sync_at TIMESTAMPTZ,
      last_webhook_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
  `);
  await pool.query(`INSERT INTO discord_zealy_settings (id, reward_feed_event_toggles, reward_feed_milestones) VALUES (1, $1::jsonb, $2::jsonb) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(ZEALY_DEFAULT_SETTINGS.rewardFeedEventToggles), JSON.stringify(ZEALY_DEFAULT_MILESTONES)]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_zealy_members (
      zealy_user_id TEXT PRIMARY KEY,
      zealy_name TEXT,
      discord_user_id TEXT,
      discord_username TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      rank INTEGER,
      sprint_xp INTEGER,
      sprint_rank INTEGER,
      avatar_url TEXT,
      raw_payload JSONB,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_zealy_members_discord_idx ON discord_zealy_members (discord_user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_zealy_members_rank_idx ON discord_zealy_members (rank);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_zealy_snapshots (
      id BIGSERIAL PRIMARY KEY,
      snapshot_type TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload_hash TEXT NOT NULL,
      raw_payload JSONB NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (snapshot_type, payload_hash)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_zealy_events (
      id BIGSERIAL PRIMARY KEY,
      provider_event_id TEXT,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      zealy_user_id TEXT,
      discord_user_id TEXT,
      quest_id TEXT,
      quest_name TEXT,
      xp_delta INTEGER,
      current_xp INTEGER,
      rank_before INTEGER,
      rank_after INTEGER,
      reward_name TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      discord_channel_id TEXT,
      discord_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS discord_zealy_events_provider_uidx ON discord_zealy_events (provider_event_id) WHERE provider_event_id IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_zealy_events_fact_idx ON discord_zealy_events (source, event_type, zealy_user_id, occurred_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_zealy_events_status_idx ON discord_zealy_events (status, occurred_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_zealy_templates (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      title_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      colour TEXT NOT NULL DEFAULT '#f35023',
      image_url TEXT,
      thumbnail_url TEXT,
      footer_text TEXT,
      buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
      reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_seeded BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS discord_zealy_templates_event_idx ON discord_zealy_templates (event_type, enabled);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_zealy_webhook_receipts (
      id BIGSERIAL PRIMARY KEY,
      delivery_id TEXT,
      event_type TEXT,
      signature_valid BOOLEAN,
      payload_hash TEXT NOT NULL,
      raw_payload JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      last_error TEXT
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS discord_zealy_webhook_receipts_delivery_uidx ON discord_zealy_webhook_receipts (delivery_id) WHERE delivery_id IS NOT NULL;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS discord_zealy_webhook_receipts_payload_uidx ON discord_zealy_webhook_receipts (payload_hash);`);
  await seedZealyTemplates();

  await pool.query(
    `
    INSERT INTO discord_payout_feed_settings (id, destination_channel_id)
    VALUES (1, $1)
    ON CONFLICT (id) DO NOTHING
    `,
    [DEFAULT_PAYOUT_SETTINGS.destinationChannelId]
  );

  await pool.query(
    `
    INSERT INTO discord_news_settings (id, destination_channel_id)
    VALUES (1, $1)
    ON CONFLICT (id) DO NOTHING
    `,
    [DEFAULT_NEWS_SETTINGS.destinationChannelId]
  );

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
  await pool.query(
    `
    UPDATE discord_settings
    SET value = jsonb_set(value, '{autoPostShorts}', 'true'::jsonb, true),
        updated_at = NOW()
    WHERE key = 'youtube'
      AND COALESCE((value->>'autoPostShorts')::boolean, false) = false
    `
  );
  await ensureSetting('channel_mappings', DEFAULT_CHANNEL_MAPPINGS, 'mappings');
  await ensureSetting('role_mappings', DEFAULT_ROLE_MAPPINGS, 'mappings');
  await seedNewsTemplates();
  await seedPayoutFeedTemplates();

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

function subscriberIdentity(user = null) {
  return {
    username: user?.username || user?.user?.username || null,
    displayName: user?.globalName || user?.displayName || user?.user?.globalName || user?.user?.username || user?.username || null,
    avatarUrl: typeof user?.displayAvatarURL === 'function'
      ? user.displayAvatarURL()
      : typeof user?.user?.displayAvatarURL === 'function'
        ? user.user.displayAvatarURL()
        : null,
  };
}

function cachedDiscordIdentity(userId) {
  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID) || client.guilds.cache.first();
  const member = guild?.members?.cache?.get?.(userId) || null;
  const user = member?.user || client.users.cache.get(userId) || null;
  return subscriberIdentity(member || user);
}

async function storeSubscriberIdentity(userId, user) {
  const identity = subscriberIdentity(user);
  if (!identity.username && !identity.displayName && !identity.avatarUrl) return;
  await pool.query(
    `
    UPDATE subscribers
    SET username = COALESCE($2, username),
        display_name = COALESCE($3, display_name),
        avatar_url = COALESCE($4, avatar_url)
    WHERE user_id = $1
    `,
    [userId, identity.username, identity.displayName, identity.avatarUrl]
  );
}

async function hydrateSubscriberIdentities(limit = 75) {
  if (subscriberHydrationRunning || !client.isReady()) return;
  subscriberHydrationRunning = true;
  try {
    const result = await pool.query(
      `
      SELECT user_id
      FROM subscribers
      WHERE username IS NULL OR display_name IS NULL
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    for (const row of result.rows) {
      const cached = cachedDiscordIdentity(row.user_id);
      if (cached.username || cached.displayName || cached.avatarUrl) {
        await storeSubscriberIdentity(row.user_id, cached);
        continue;
      }
      const user = await client.users.fetch(row.user_id).catch(() => null);
      if (user) await storeSubscriberIdentity(row.user_id, user);
      await sleep(150);
    }
  } catch (error) {
    console.log(`Subscriber identity hydration failed: ${error.message}`);
  } finally {
    subscriberHydrationRunning = false;
  }
}

function scheduleSubscriberIdentityHydration(limit = 75) {
  if (!client.isReady() || subscriberHydrationRunning) return;
  setImmediate(() => hydrateSubscriberIdentities(limit));
}

async function addSubscriber(userId, user = null) {
  const identity = subscriberIdentity(user);
  const result = await pool.query(
    `
    INSERT INTO subscribers (user_id, status, unsubscribed_at, username, display_name, avatar_url)
    VALUES ($1, 'subscribed', NULL, $2, $3, $4)
    ON CONFLICT (user_id)
    DO UPDATE SET status = 'subscribed',
                  unsubscribed_at = NULL,
                  username = COALESCE(EXCLUDED.username, subscribers.username),
                  display_name = COALESCE(EXCLUDED.display_name, subscribers.display_name),
                  avatar_url = COALESCE(EXCLUDED.avatar_url, subscribers.avatar_url)
    WHERE subscribers.status IS DISTINCT FROM 'subscribed'
       OR subscribers.unsubscribed_at IS NOT NULL
       OR EXCLUDED.username IS NOT NULL
       OR EXCLUDED.display_name IS NOT NULL
       OR EXCLUDED.avatar_url IS NOT NULL
    RETURNING user_id
    `,
    [userId, identity.username, identity.displayName, identity.avatarUrl]
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

async function getJsonAppState(key, fallback) {
  const raw = await getAppState(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

async function setJsonAppState(key, value) {
  await setAppState(key, JSON.stringify(value));
}

async function acquireAdvisoryLock(key) {
  const dbClient = await pool.connect();
  try {
    const result = await dbClient.query(`SELECT pg_try_advisory_lock($1) AS locked`, [key]);
    if (result.rows[0]?.locked) return dbClient;
    dbClient.release();
    return null;
  } catch (error) {
    dbClient.release();
    throw error;
  }
}

async function releaseAdvisoryLock(dbClient, key) {
  if (!dbClient) return;
  try {
    await dbClient.query(`SELECT pg_advisory_unlock($1)`, [key]);
  } finally {
    dbClient.release();
  }
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

function normalizeButtonUrl(value, label = 'Button URL', { allowMailto = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (allowMailto && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return `mailto:${raw}`;
  }
  if (allowMailto && /^mailto:/i.test(raw)) {
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

function sanitizeButtons(buttons, options = {}) {
  if (!Array.isArray(buttons)) return [];

  return buttons
    .map(button => {
      try {
        return {
          label: String(button?.label || '').trim(),
          url: button?.url ? normalizeButtonUrl(button.url, 'Button URL', options) : null,
        };
      } catch (error) {
        if (options.dropInvalid) return null;
        throw error;
      }
    })
    .filter(Boolean)
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
        buttons: sanitizeButtons(block?.buttons || [], { allowMailto: true, dropInvalid: true }),
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
    const inlineLinks = sanitizeButtons(block.buttons || [], { allowMailto: true, dropInvalid: true }).map(button => `[${button.label}](${button.url})`);
    if (inlineLinks.length) blockLines.push(inlineLinks.join('  |  '));
    if (blockLines.length) lines.push(blockLines.join('\n'));
  }

  return lines.filter(Boolean).join('\n\n').slice(0, 4096);
}

function managedButtonsFromPayload(payload) {
  return sanitizeButtons(payload.buttons || []).slice(0, 25);
}

function buildButtonRows(buttons) {
  const safeButtons = sanitizeButtons(buttons, { dropInvalid: true });
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

function decryptSecretValue(row) {
  const key = getEncryptionKey();
  if (!key || !row?.encrypted_value || !row?.iv || !row?.auth_tag || !row?.configured) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_value, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function getStoredSecretValue(secretKey) {
  const result = await pool.query(`SELECT * FROM discord_secret_settings WHERE key = $1 AND configured = true`, [secretKey]);
  if (!result.rowCount) return process.env[secretKey] || null;
  return decryptSecretValue(result.rows[0]) || process.env[secretKey] || null;
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

function normalizeNewsImpact(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!raw) return 'LOW';
  if (raw.includes('high')) return 'HIGH';
  if (raw.includes('medium') || raw.includes('med')) return 'MEDIUM';
  if (raw.includes('low')) return 'LOW';
  if (raw.includes('holiday')) return 'HOLIDAY';
  if (raw.includes('tentative')) return 'TENTATIVE';
  if (raw.includes('non') || raw.includes('none')) return 'NON_ECONOMIC';
  return 'LOW';
}

function normalizeNewsCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function normalizeNewsSettingRow(row) {
  if (!row) return { ...DEFAULT_NEWS_SETTINGS };
  return {
    enabled: Boolean(row.enabled),
    provider: row.provider || NEWS_PROVIDER,
    feedUrl: row.feed_url || DEFAULT_NEWS_FEED_URL,
    destinationChannelId: row.destination_channel_id || null,
    timezone: row.timezone || 'Europe/London',
    refreshIntervalMinutes: Math.max(1, Number(row.refresh_interval_minutes || 15)),
    selectedCurrencies: Array.isArray(row.selected_currencies) ? row.selected_currencies : DEFAULT_NEWS_CURRENCIES,
    includeHighImpact: Boolean(row.include_high_impact),
    includeMediumImpact: Boolean(row.include_medium_impact),
    includeLowImpact: Boolean(row.include_low_impact),
    includeHolidays: Boolean(row.include_holidays),
    includeTentative: Boolean(row.include_tentative),
    dailySummaryEnabled: Boolean(row.daily_summary_enabled),
    dailySummaryTime: row.daily_summary_time || '07:00',
    dailySummaryMentionEveryone: Boolean(row.daily_summary_mention_everyone),
    highImpactAlertEnabled: Boolean(row.high_impact_alert_enabled),
    highImpactMinutesBefore: Number(row.high_impact_minutes_before || 15),
    highImpactMentionEveryone: Boolean(row.high_impact_mention_everyone),
    mediumImpactAlertEnabled: Boolean(row.medium_impact_alert_enabled),
    mediumImpactMinutesBefore: Number(row.medium_impact_minutes_before || 15),
    mediumImpactMentionEveryone: Boolean(row.medium_impact_mention_everyone),
    lowImpactAlertEnabled: Boolean(row.low_impact_alert_enabled),
    lowImpactMinutesBefore: Number(row.low_impact_minutes_before || 15),
    lowImpactMentionEveryone: Boolean(row.low_impact_mention_everyone),
    defaultReactions: sanitizeReactions(row.default_reactions, DEFAULT_NEWS_REACTIONS),
    highImpactTemplateId: row.high_impact_template_id || null,
    mediumImpactTemplateId: row.medium_impact_template_id || null,
    lowImpactTemplateId: row.low_impact_template_id || null,
    dailySummaryTemplateId: row.daily_summary_template_id || null,
    eventTimeTemplateId: row.event_time_template_id || null,
    updatedBy: row.updated_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function getNewsSettings() {
  const result = await pool.query(`SELECT * FROM discord_news_settings WHERE id = 1`);
  if (!result.rowCount) {
    await pool.query(
      `
      INSERT INTO discord_news_settings (id, destination_channel_id)
      VALUES (1, $1)
      ON CONFLICT (id) DO NOTHING
      `,
      [DEFAULT_NEWS_SETTINGS.destinationChannelId]
    );
    return { ...DEFAULT_NEWS_SETTINGS };
  }
  return normalizeNewsSettingRow(result.rows[0]);
}

function validateNewsFeedUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_NEWS_FEED_URL).trim());
  } catch (_) {
    throw createApiError('NEWS_FEED_URL_INVALID', 'Feed URL must be a valid HTTPS URL', 400);
  }
  if (url.protocol !== 'https:') {
    throw createApiError('NEWS_FEED_URL_HTTPS_REQUIRED', 'Feed URL must use HTTPS', 400);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.railway.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc00:|fd00:)/i.test(hostname)
  ) {
    throw createApiError('NEWS_FEED_URL_BLOCKED', 'Feed URL cannot target private or internal hosts', 400);
  }
  return url.toString();
}

function sanitizeNewsSettingsPatch(body = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) patch.enabled = toBoolean(body.enabled, false);
  if (body.provider) patch.provider = String(body.provider).trim().toUpperCase().slice(0, 50) || NEWS_PROVIDER;
  if (Object.prototype.hasOwnProperty.call(body, 'feedUrl') || Object.prototype.hasOwnProperty.call(body, 'feed_url')) {
    patch.feedUrl = validateNewsFeedUrl(body.feedUrl || body.feed_url);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'destinationChannelId') || Object.prototype.hasOwnProperty.call(body, 'destination_channel_id')) {
    const channelId = body.destinationChannelId || body.destination_channel_id || null;
    patch.destinationChannelId = channelId ? requireDiscordId(channelId, 'Destination channel ID') : null;
  }
  if (body.timezone) patch.timezone = String(body.timezone).trim().slice(0, 80) || 'Europe/London';
  if (Object.prototype.hasOwnProperty.call(body, 'refreshIntervalMinutes')) {
    patch.refreshIntervalMinutes = Math.max(5, Math.min(Number(body.refreshIntervalMinutes) || 15, 1440));
  }
  if (Array.isArray(body.selectedCurrencies)) {
    const selected = body.selectedCurrencies
      .map(normalizeNewsCurrency)
      .filter(Boolean);
    patch.selectedCurrencies = selected.length ? Array.from(new Set(selected)).slice(0, 60) : [];
  }
  const booleanKeys = [
    'includeHighImpact',
    'includeMediumImpact',
    'includeLowImpact',
    'includeHolidays',
    'includeTentative',
    'dailySummaryEnabled',
    'dailySummaryMentionEveryone',
    'highImpactAlertEnabled',
    'highImpactMentionEveryone',
    'mediumImpactAlertEnabled',
    'mediumImpactMentionEveryone',
    'lowImpactAlertEnabled',
    'lowImpactMentionEveryone',
  ];
  for (const key of booleanKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = toBoolean(body[key], false);
  }
  const minuteKeys = ['highImpactMinutesBefore', 'mediumImpactMinutesBefore', 'lowImpactMinutesBefore'];
  for (const key of minuteKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = Math.max(0, Math.min(Number(body[key]) || 0, 1440));
  }
  if (body.dailySummaryTime) {
    const time = String(body.dailySummaryTime).trim();
    if (!/^\d{2}:\d{2}$/.test(time)) throw createApiError('NEWS_DAILY_TIME_INVALID', 'Daily summary time must be HH:mm', 400);
    patch.dailySummaryTime = time;
  }
  if (Array.isArray(body.defaultReactions)) patch.defaultReactions = sanitizeReactions(body.defaultReactions, DEFAULT_NEWS_REACTIONS).slice(0, 20);
  for (const key of ['highImpactTemplateId', 'mediumImpactTemplateId', 'lowImpactTemplateId', 'dailySummaryTemplateId', 'eventTimeTemplateId']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key] ? Number(body[key]) : null;
  }
  return patch;
}

async function updateNewsSettings(patch, actor = null) {
  const current = await getNewsSettings();
  const next = { ...current, ...patch };
  await pool.query(
    `
    UPDATE discord_news_settings
    SET enabled = $1,
        provider = $2,
        feed_url = $3,
        destination_channel_id = $4,
        timezone = $5,
        refresh_interval_minutes = $6,
        selected_currencies = $7::jsonb,
        include_high_impact = $8,
        include_medium_impact = $9,
        include_low_impact = $10,
        include_holidays = $11,
        include_tentative = $12,
        daily_summary_enabled = $13,
        daily_summary_time = $14,
        daily_summary_mention_everyone = $15,
        high_impact_alert_enabled = $16,
        high_impact_minutes_before = $17,
        high_impact_mention_everyone = $18,
        medium_impact_alert_enabled = $19,
        medium_impact_minutes_before = $20,
        medium_impact_mention_everyone = $21,
        low_impact_alert_enabled = $22,
        low_impact_minutes_before = $23,
        low_impact_mention_everyone = $24,
        default_reactions = $25::jsonb,
        high_impact_template_id = $26,
        medium_impact_template_id = $27,
        low_impact_template_id = $28,
        daily_summary_template_id = $29,
        event_time_template_id = $30,
        updated_by = $31,
        updated_at = NOW()
    WHERE id = 1
    RETURNING *
    `,
    [
      next.enabled,
      next.provider,
      next.feedUrl,
      next.destinationChannelId,
      next.timezone,
      next.refreshIntervalMinutes,
      JSON.stringify(next.selectedCurrencies || []),
      next.includeHighImpact,
      next.includeMediumImpact,
      next.includeLowImpact,
      next.includeHolidays,
      next.includeTentative,
      next.dailySummaryEnabled,
      next.dailySummaryTime,
      next.dailySummaryMentionEveryone,
      next.highImpactAlertEnabled,
      next.highImpactMinutesBefore,
      next.highImpactMentionEveryone,
      next.mediumImpactAlertEnabled,
      next.mediumImpactMinutesBefore,
      next.mediumImpactMentionEveryone,
      next.lowImpactAlertEnabled,
      next.lowImpactMinutesBefore,
      next.lowImpactMentionEveryone,
      JSON.stringify(next.defaultReactions || DEFAULT_NEWS_REACTIONS),
      next.highImpactTemplateId,
      next.mediumImpactTemplateId,
      next.lowImpactTemplateId,
      next.dailySummaryTemplateId,
      next.eventTimeTemplateId,
      actor,
    ]
  );
  return getNewsSettings();
}

function stableNewsEventKey(provider, event) {
  const value = [
    provider || NEWS_PROVIDER,
    event.title || '',
    event.currency || '',
    new Date(event.scheduledAt).toISOString(),
  ].join('|').toLowerCase();
  return crypto.createHash('sha256').update(value).digest('hex');
}

function newsEventIdentityKey(event) {
  return [
    String(event.title || '').trim().toLowerCase().replace(/\s+/g, ' '),
    String(event.currency || '').trim().toUpperCase(),
  ].join('|');
}

function parseNewsDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  const value = String(raw).trim();
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = value.replace(/^(\d{4})(\d{2})(\d{2})\s+/, '$1-$2-$3T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeForexFactoryEvent(row, provider = NEWS_PROVIDER) {
  const title = String(row.title || row.event || row.name || '').trim();
  const countryValue = String(row.country || '').trim();
  const currency = normalizeNewsCurrency(row.currency || row.ccy || row.countryCode || countryValue);
  const scheduledAt = parseNewsDate(row.date || row.datetime || row.time || row.timestamp || row.scheduled_at);
  if (!title || !currency || !scheduledAt) return null;
  const impact = normalizeNewsImpact(row.impact || row.importance || row.severity);
  return {
    provider,
    title,
    currency,
    country: normalizeNewsCurrency(countryValue) ? null : (countryValue || row.country_name || null),
    impact,
    scheduledAt,
    forecast: row.forecast == null ? null : String(row.forecast),
    previous: row.previous == null ? null : String(row.previous),
    actual: row.actual == null ? null : String(row.actual),
    sourceUrl: row.url || row.source_url || row.link || null,
    rawPayload: row,
  };
}

function normalizeForexFactoryPayload(payload, provider = NEWS_PROVIDER) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
      ? payload.events
      : Array.isArray(payload?.calendar)
        ? payload.calendar
        : null;
  if (!rows) throw createApiError('NEWS_FEED_SHAPE_INVALID', 'Feed JSON must be an array or contain an events array', 502);
  return rows.map(row => normalizeForexFactoryEvent(row, provider)).filter(Boolean);
}

async function fetchNewsFeed(feedUrl, { retries = 2 } = {}) {
  const safeUrl = validateNewsFeedUrl(feedUrl || DEFAULT_NEWS_FEED_URL);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NEWS_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(safeUrl, {
        headers: { 'User-Agent': NEWS_USER_AGENT, Accept: 'application/json,text/json;q=0.9' },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      if (!response.ok) throw createApiError('NEWS_FEED_HTTP_ERROR', `Feed returned HTTP ${response.status}`, 502);
      if (/^\s*</.test(text) || contentType.includes('text/html')) throw createApiError('NEWS_FEED_HTML_RESPONSE', 'Feed returned HTML instead of JSON', 502);
      if (text.length > 5_000_000) throw createApiError('NEWS_FEED_TOO_LARGE', 'Feed response is too large', 502);
      return JSON.parse(text);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError || createApiError('NEWS_FEED_FETCH_FAILED', 'Feed fetch failed', 502);
}

function newsEventPassesFilters(event, settings) {
  const currencies = Array.isArray(settings.selectedCurrencies) ? settings.selectedCurrencies.map(normalizeNewsCurrency).filter(Boolean) : [];
  if (currencies.length && !currencies.includes(event.currency)) return false;
  if (event.impact === 'HIGH') return settings.includeHighImpact;
  if (event.impact === 'MEDIUM') return settings.includeMediumImpact;
  if (event.impact === 'LOW') return settings.includeLowImpact;
  if (event.impact === 'HOLIDAY') return settings.includeHolidays;
  if (event.impact === 'TENTATIVE') return settings.includeTentative;
  return false;
}

function alertConfigForImpact(impact, settings) {
  if (impact === 'HIGH') return {
    enabled: settings.highImpactAlertEnabled,
    minutesBefore: settings.highImpactMinutesBefore,
    mentionEveryone: settings.highImpactMentionEveryone,
    templateId: settings.highImpactTemplateId,
    alertType: 'HIGH_IMPACT_ADVANCE',
  };
  if (impact === 'MEDIUM') return {
    enabled: settings.mediumImpactAlertEnabled,
    minutesBefore: settings.mediumImpactMinutesBefore,
    mentionEveryone: settings.mediumImpactMentionEveryone,
    templateId: settings.mediumImpactTemplateId,
    alertType: 'MEDIUM_IMPACT_ADVANCE',
  };
  if (impact === 'LOW') return {
    enabled: settings.lowImpactAlertEnabled,
    minutesBefore: settings.lowImpactMinutesBefore,
    mentionEveryone: settings.lowImpactMentionEveryone,
    templateId: settings.lowImpactTemplateId,
    alertType: 'LOW_IMPACT_ADVANCE',
  };
  return null;
}

function formatInTimezone(date, timezone = 'Europe/London', options = {}) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      dateStyle: options.dateStyle || 'medium',
      timeStyle: options.timeStyle || 'short',
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

function newsTemplateValues(event, settings = DEFAULT_NEWS_SETTINGS, extra = {}) {
  const scheduled = event?.scheduled_at || event?.scheduledAt ? new Date(event.scheduled_at || event.scheduledAt) : new Date();
  const unix = Math.floor(scheduled.getTime() / 1000);
  return {
    title: event?.title || '',
    currency: event?.currency || '',
    country: event?.country || '',
    impact: event?.impact || '',
    scheduled_at: scheduled.toISOString(),
    uk_time: formatInTimezone(scheduled, 'Europe/London'),
    discord_time_full: `<t:${unix}:F>`,
    discord_time_relative: `<t:${unix}:R>`,
    forecast: event?.forecast || '',
    previous: event?.previous || '',
    actual: event?.actual || '',
    forecast_or_na: event?.forecast || 'N/A',
    previous_or_na: event?.previous || 'N/A',
    actual_or_na: event?.actual || 'N/A',
    minutes_before: extra.minutesBefore ?? '',
    event_url: event?.source_url || event?.sourceUrl || '',
    event_list: extra.eventList || '',
    event_count: extra.eventCount ?? '',
    date: extra.date || formatInTimezone(scheduled, settings.timezone || 'Europe/London', { dateStyle: 'full', timeStyle: undefined }),
  };
}

function renderNewsTemplateString(template, values) {
  return String(template || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return values[key] === undefined || values[key] === null ? '' : String(values[key]);
  });
}

function sanitizeNewsTemplatePayload(body = {}, existing = {}) {
  const templateType = String(body.templateType || body.template_type || existing.template_type || existing.templateType || 'CUSTOM').trim().toUpperCase();
  if (!NEWS_TEMPLATE_TYPES.has(templateType)) throw createApiError('NEWS_TEMPLATE_TYPE_INVALID', 'Invalid news template type', 400);
  const name = String(body.name ?? existing.name ?? '').trim();
  if (!name) throw createApiError('NEWS_TEMPLATE_NAME_REQUIRED', 'Template name is required', 400);
  const titleTemplate = String(body.titleTemplate ?? body.title_template ?? existing.title_template ?? existing.titleTemplate ?? '').trim();
  const bodyTemplate = String(body.bodyTemplate ?? body.body_template ?? existing.body_template ?? existing.bodyTemplate ?? '').trim();
  if (!titleTemplate || !bodyTemplate) throw createApiError('NEWS_TEMPLATE_BODY_REQUIRED', 'Title and body templates are required', 400);
  validateTextLength(titleTemplate, 256, 'News template title');
  validateTextLength(bodyTemplate, 4096, 'News template body');
  return {
    name,
    templateType,
    enabled: toBoolean(body.enabled, existing.enabled ?? true),
    titleTemplate,
    bodyTemplate,
    colour: body.colour || body.color || existing.colour || existing.color || '#f35023',
    imageUrl: body.imageUrl || body.image_url || existing.image_url || existing.imageUrl || null,
    thumbnailUrl: body.thumbnailUrl || body.thumbnail_url || existing.thumbnail_url || existing.thumbnailUrl || null,
    footerText: body.footerText || body.footer_text || existing.footer_text || existing.footerText || BRAND_FOOTER,
    buttons: sanitizeButtons(body.buttons ?? existing.buttons ?? [], { allowMailto: true, dropInvalid: true }),
    reactions: sanitizeReactions(body.reactions ?? existing.reactions ?? DEFAULT_NEWS_REACTIONS, DEFAULT_NEWS_REACTIONS),
  };
}

function serializeNewsTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.template_type,
    templateType: row.template_type,
    enabled: Boolean(row.enabled),
    titleTemplate: row.title_template,
    bodyTemplate: row.body_template,
    colour: row.colour,
    color: row.colour,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
    footerText: row.footer_text,
    buttons: row.buttons || [],
    reactions: row.reactions || [],
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    variableHelpers: NEWS_TEMPLATE_VARIABLES,
  };
}

async function seedNewsTemplates() {
  for (const template of DEFAULT_NEWS_TEMPLATES) {
    await pool.query(
      `
      INSERT INTO discord_news_templates
        (name, template_type, enabled, title_template, body_template, colour, footer_text, buttons, reactions)
      VALUES ($1, $2, true, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      ON CONFLICT (template_type, name) DO NOTHING
      `,
      [
        template.name,
        template.templateType,
        template.titleTemplate,
        template.bodyTemplate,
        template.colour,
        BRAND_FOOTER,
        JSON.stringify([]),
        JSON.stringify(template.reactions || DEFAULT_NEWS_REACTIONS),
      ]
    );
  }
}

async function getNewsTemplateForAlert(alertType, settings, explicitTemplateId = null) {
  const configuredId = explicitTemplateId
    || (alertType === 'HIGH_IMPACT_ADVANCE' ? settings.highImpactTemplateId
      : alertType === 'MEDIUM_IMPACT_ADVANCE' ? settings.mediumImpactTemplateId
        : alertType === 'LOW_IMPACT_ADVANCE' ? settings.lowImpactTemplateId
          : alertType === 'DAILY_SUMMARY' ? settings.dailySummaryTemplateId
            : alertType === 'EVENT_TIME' ? settings.eventTimeTemplateId
              : null);
  if (configuredId) {
    const result = await pool.query(`SELECT * FROM discord_news_templates WHERE id = $1 AND enabled = true`, [configuredId]);
    if (result.rowCount) return result.rows[0];
  }
  const fallback = await pool.query(
    `SELECT * FROM discord_news_templates WHERE template_type = $1 AND enabled = true ORDER BY id ASC LIMIT 1`,
    [alertType]
  );
  return fallback.rows[0] || null;
}

function serializeNewsEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    providerEventKey: row.provider_event_key,
    title: row.title,
    currency: row.currency,
    country: row.country,
    impact: row.impact,
    scheduledAt: row.scheduled_at,
    forecast: row.forecast,
    previous: row.previous,
    actual: row.actual,
    sourceUrl: row.source_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    cancelled: Boolean(row.cancelled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeNewsAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    newsEventId: row.news_event_id,
    alertType: row.alert_type,
    scheduledFor: row.scheduled_for,
    destinationChannelId: row.destination_channel_id,
    mentionEveryone: Boolean(row.mention_everyone),
    templateId: row.template_id || null,
    status: row.status,
    discordMessageId: row.discord_message_id,
    attemptCount: Number(row.attempt_count || 0),
    lastError: row.last_error,
    sentAt: row.sent_at,
    metadata: row.metadata || {},
    event: row.title ? serializeNewsEvent(row) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertNewsEvent(event, settings) {
  const providerEventKey = stableNewsEventKey(event.provider, event);
  const identity = newsEventIdentityKey(event);
  const weekStart = new Date(event.scheduledAt);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const weekEnd = new Date(event.scheduledAt);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  let existing = await pool.query(
    `SELECT * FROM discord_news_events WHERE provider_event_key = $1`,
    [providerEventKey]
  );

  if (!existing.rowCount) {
    existing = await pool.query(
      `
      SELECT *
      FROM discord_news_events
      WHERE provider = $1
        AND LOWER(TRIM(title)) = LOWER(TRIM($2))
        AND COALESCE(currency, '') = COALESCE($3, '')
        AND scheduled_at BETWEEN $4 AND $5
        AND cancelled = false
      ORDER BY ABS(EXTRACT(EPOCH FROM (scheduled_at - $6::timestamptz))) ASC
      LIMIT 1
      `,
      [event.provider, event.title, event.currency, weekStart, weekEnd, event.scheduledAt]
    );
  }

  if (existing.rowCount) {
    const row = existing.rows[0];
    const timeChanged = new Date(row.scheduled_at).getTime() !== event.scheduledAt.getTime();
    if (timeChanged) {
      await pool.query(
        `
        UPDATE discord_news_alerts
        SET status = 'CANCELLED', last_error = 'Event time changed; replacement alert scheduled.', updated_at = NOW()
        WHERE news_event_id = $1 AND status IN ('PENDING', 'FAILED')
        `,
        [row.id]
      );
      await logActivity({
        type: 'news',
        action: 'event_time_changed',
        source: 'bot',
        entityType: 'discord_news_event',
        entityId: String(row.id),
        metadata: { oldScheduledAt: row.scheduled_at, newScheduledAt: event.scheduledAt, identity },
      });
    }
    const updated = await pool.query(
      `
      UPDATE discord_news_events
      SET provider_event_key = $2,
          title = $3,
          currency = $4,
          country = $5,
          impact = $6,
          scheduled_at = $7,
          forecast = $8,
          previous = $9,
          actual = $10,
          source_url = $11,
          raw_payload = $12::jsonb,
          last_seen_at = NOW(),
          updated_at = NOW(),
          cancelled = false
      WHERE id = $1
      RETURNING *
      `,
      [
        row.id,
        providerEventKey,
        event.title,
        event.currency,
        event.country,
        event.impact,
        event.scheduledAt,
        event.forecast,
        event.previous,
        event.actual,
        event.sourceUrl,
        JSON.stringify(event.rawPayload || {}),
      ]
    );
    return { row: updated.rows[0], created: false, timeChanged };
  }

  const inserted = await pool.query(
    `
    INSERT INTO discord_news_events
      (provider, provider_event_key, title, currency, country, impact, scheduled_at, forecast, previous, actual, source_url, raw_payload)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
    RETURNING *
    `,
    [
      event.provider,
      providerEventKey,
      event.title,
      event.currency,
      event.country,
      event.impact,
      event.scheduledAt,
      event.forecast,
      event.previous,
      event.actual,
      event.sourceUrl,
      JSON.stringify(event.rawPayload || {}),
    ]
  );
  await logActivity({
    type: 'news',
    action: 'event_created',
    source: 'bot',
    entityType: 'discord_news_event',
    entityId: String(inserted.rows[0].id),
    metadata: { title: event.title, currency: event.currency, impact: event.impact, scheduledAt: event.scheduledAt },
  });
  return { row: inserted.rows[0], created: true, timeChanged: false };
}

async function scheduleNewsAlertsForEvent(eventRow, settings) {
  if (!settings.destinationChannelId) return 0;
  const event = serializeNewsEvent(eventRow);
  if (!newsEventPassesFilters({ ...event, scheduledAt: new Date(event.scheduledAt) }, settings)) return 0;
  const config = alertConfigForImpact(event.impact, settings);
  if (!config || !config.enabled) return 0;
  const scheduledFor = new Date(new Date(event.scheduledAt).getTime() - Number(config.minutesBefore || 0) * 60 * 1000);
  if (scheduledFor.getTime() < Date.now() - NEWS_STALE_ALERT_GRACE_MINUTES * 60 * 1000) return 0;
  const result = await pool.query(
    `
    INSERT INTO discord_news_alerts
      (news_event_id, alert_type, scheduled_for, destination_channel_id, mention_everyone, template_id, status, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      event.id,
      config.alertType,
      scheduledFor,
      settings.destinationChannelId,
      Boolean(config.mentionEveryone),
      config.templateId || null,
      JSON.stringify({ minutesBefore: config.minutesBefore }),
    ]
  );
  if (result.rowCount) {
    await logActivity({
      type: 'news',
      action: 'alert_scheduled',
      source: 'bot',
      entityType: 'discord_news_alert',
      entityId: String(result.rows[0].id),
      metadata: { eventId: event.id, alertType: config.alertType, scheduledFor, mentionEveryone: Boolean(config.mentionEveryone) },
    });
  }
  return result.rowCount;
}

function localDateKey(date, timezone = 'Europe/London') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}

function dailySummaryScheduledAt(dayDate, time, timezone = 'Europe/London') {
  const [hour, minute] = String(time || '07:00').split(':').map(Number);
  const dateKey = localDateKey(dayDate, timezone);
  const naive = new Date(`${dateKey}T${String(hour || 0).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}:00.000Z`);
  return naive;
}

async function scheduleDailyNewsSummaries(settings) {
  if (!settings.dailySummaryEnabled || !settings.destinationChannelId) return 0;
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  const eventsResult = await pool.query(
    `
    SELECT *
    FROM discord_news_events
    WHERE scheduled_at >= $1 AND scheduled_at < $2 AND cancelled = false
    ORDER BY scheduled_at ASC
    `,
    [start, end]
  );
  const days = new Set();
  for (const row of eventsResult.rows) {
    const event = serializeNewsEvent(row);
    if (newsEventPassesFilters({ ...event, scheduledAt: new Date(event.scheduledAt) }, settings)) {
      days.add(localDateKey(new Date(row.scheduled_at), settings.timezone));
    }
  }
  let created = 0;
  for (const day of days) {
    const scheduledFor = dailySummaryScheduledAt(new Date(`${day}T12:00:00.000Z`), settings.dailySummaryTime, settings.timezone);
    if (scheduledFor.getTime() < Date.now() - NEWS_STALE_ALERT_GRACE_MINUTES * 60 * 1000) continue;
    const result = await pool.query(
      `
      INSERT INTO discord_news_alerts
        (news_event_id, alert_type, scheduled_for, destination_channel_id, mention_everyone, template_id, status, metadata)
      VALUES (NULL, 'DAILY_SUMMARY', $1, $2, $3, $4, 'PENDING', $5::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id
      `,
      [
        scheduledFor,
        settings.destinationChannelId,
        settings.dailySummaryMentionEveryone,
        settings.dailySummaryTemplateId || null,
        JSON.stringify({ date: day }),
      ]
    );
    created += result.rowCount;
  }
  return created;
}

async function syncNewsFeed({ actor = null, manual = false } = {}) {
  if (newsSyncRunning && !manual) return { skipped: true, reason: 'already_running' };
  newsSyncRunning = true;
  const settings = await getNewsSettings();
  const started = await pool.query(
    `INSERT INTO discord_news_sync_logs (provider, status) VALUES ($1, 'RUNNING') RETURNING id`,
    [settings.provider]
  );
  const logId = started.rows[0].id;
  await logActivity({ type: 'news', action: 'feed_sync_started', actor, source: manual ? 'crm_api' : 'bot' });
  let eventsReceived = 0;
  let eventsCreated = 0;
  let eventsUpdated = 0;
  let alertsCreated = 0;
  try {
    const payload = await fetchNewsFeed(settings.feedUrl);
    const events = normalizeForexFactoryPayload(payload, settings.provider);
    eventsReceived = events.length;
    for (const event of events) {
      try {
        const result = await upsertNewsEvent(event, settings);
        if (result.created) eventsCreated += 1;
        else eventsUpdated += 1;
        alertsCreated += await scheduleNewsAlertsForEvent(result.row, settings);
      } catch (error) {
        await logActivity({ type: 'news', action: 'event_upsert_failed', source: 'bot', metadata: { title: event.title, currency: event.currency }, errorMessage: error.message });
      }
    }
    alertsCreated += await scheduleDailyNewsSummaries(settings);
    await pool.query(
      `
      UPDATE discord_news_sync_logs
      SET status = 'SUCCESS',
          completed_at = NOW(),
          events_received = $2,
          events_created = $3,
          events_updated = $4,
          alerts_created = $5
      WHERE id = $1
      `,
      [logId, eventsReceived, eventsCreated, eventsUpdated, alertsCreated]
    );
    await logActivity({ type: 'news', action: 'feed_sync_completed', actor, source: manual ? 'crm_api' : 'bot', metadata: { eventsReceived, eventsCreated, eventsUpdated, alertsCreated } });
    return { eventsReceived, eventsCreated, eventsUpdated, alertsCreated };
  } catch (error) {
    await pool.query(
      `
      UPDATE discord_news_sync_logs
      SET status = 'FAILED', completed_at = NOW(), error_code = $2, error_message = $3
      WHERE id = $1
      `,
      [logId, error.code || 'NEWS_SYNC_FAILED', sanitizePublicErrorMessage(error)]
    );
    await logActivity({ type: 'news', action: 'feed_sync_failed', actor, source: manual ? 'crm_api' : 'bot', errorMessage: sanitizePublicErrorMessage(error) });
    if (manual) throw error;
    return { failed: true, error: sanitizePublicErrorMessage(error) };
  } finally {
    newsSyncRunning = false;
  }
}

function buildNewsEmbed(templateRow, event, settings, extra = {}) {
  const values = newsTemplateValues(event, settings, extra);
  const title = renderNewsTemplateString(templateRow.title_template, values).slice(0, 256);
  const body = renderNewsTemplateString(templateRow.body_template, values).slice(0, 4096);
  const embed = new EmbedBuilder()
    .setColor(parseColor(templateRow.colour, BRAND_COLOR))
    .setTitle(title || BRAND_NAME)
    .setDescription(body)
    .setFooter({ text: String(templateRow.footer_text || BRAND_FOOTER).slice(0, 2048), iconURL: LOGO_URL })
    .setTimestamp();
  if (templateRow.image_url) embed.setImage(validateUrl(templateRow.image_url, 'News template image URL'));
  if (templateRow.thumbnail_url) embed.setThumbnail(validateUrl(templateRow.thumbnail_url, 'News template thumbnail URL'));
  return embed;
}

async function eventsForDailySummary(day, settings) {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const result = await pool.query(
    `
    SELECT *
    FROM discord_news_events
    WHERE scheduled_at >= $1 AND scheduled_at < $2 AND cancelled = false
    ORDER BY scheduled_at ASC
    `,
    [start, end]
  );
  return result.rows
    .map(serializeNewsEvent)
    .filter(event => newsEventPassesFilters({ ...event, scheduledAt: new Date(event.scheduledAt) }, settings));
}

function buildDailyEventList(events) {
  if (!events.length) return 'No selected economic events are currently stored for this date.';
  return events.map(event => {
    const scheduled = new Date(event.scheduledAt);
    const unix = Math.floor(scheduled.getTime() / 1000);
    const icon = event.impact === 'HIGH' ? '🔴' : event.impact === 'MEDIUM' ? '🟠' : event.impact === 'LOW' ? '🟡' : '⚪';
    return `${icon} **${event.currency} — ${event.title}** · <t:${unix}:t> · ${event.impact}`;
  }).join('\n');
}

async function validateNewsChannel(channelId, mentionEveryone = false) {
  const channel = await fetchTextChannel(channelId);
  const permissions = client.user ? channel.permissionsFor(client.user) : null;
  if (permissions && !permissions.has(PermissionFlagsBits.EmbedLinks)) {
    throw createApiError('NEWS_CHANNEL_EMBED_PERMISSION_MISSING', 'Bot cannot embed links in this channel', 403);
  }
  const canMentionEveryone = !permissions || permissions.has(PermissionFlagsBits.MentionEveryone);
  const canAddReactions = !permissions || permissions.has(PermissionFlagsBits.AddReactions);
  return { channel, canMentionEveryone, canAddReactions, mentionEveryone: mentionEveryone && canMentionEveryone };
}

async function sendNewsAlert(alertRow, { test = false } = {}) {
  const settings = await getNewsSettings();
  const alert = alertRow;
  const isDaily = alert.alert_type === 'DAILY_SUMMARY';
  const event = isDaily
    ? null
    : (await pool.query(`SELECT * FROM discord_news_events WHERE id = $1`, [alert.news_event_id])).rows[0];
  const template = await getNewsTemplateForAlert(alert.alert_type, settings, alert.template_id);
  if (!template) throw createApiError('NEWS_TEMPLATE_MISSING', `No enabled template found for ${alert.alert_type}`, 400);
  const destinationChannelId = alert.destination_channel_id || settings.destinationChannelId;
  if (!destinationChannelId) throw createApiError('NEWS_CHANNEL_MISSING', 'News destination channel is not configured', 400);
  const channelCheck = await validateNewsChannel(destinationChannelId, alert.mention_everyone);
  if (alert.mention_everyone && !channelCheck.canMentionEveryone) {
    await logActivity({
      type: 'news',
      action: 'missing_mention_permission',
      source: test ? 'crm_api' : 'bot',
      entityType: 'discord_news_alert',
      entityId: String(alert.id || 'test'),
      metadata: { channelId: destinationChannelId },
      errorMessage: 'Bot lacks Mention Everyone permission; posted without @everyone.',
    });
  }
  let embed;
  let reactions = sanitizeReactions(template.reactions, settings.defaultReactions);
  if (isDaily) {
    const day = alert.metadata?.date || localDateKey(new Date(alert.scheduled_for), settings.timezone);
    const events = await eventsForDailySummary(day, settings);
    const valuesEvent = { title: 'Daily Summary', currency: '', impact: 'SUMMARY', scheduled_at: alert.scheduled_for, scheduledAt: alert.scheduled_for };
    embed = buildNewsEmbed(template, valuesEvent, settings, {
      eventList: buildDailyEventList(events),
      eventCount: events.length,
      date: day,
    });
  } else {
    const minutesBefore = alert.metadata?.minutesBefore ?? Math.max(0, Math.round((new Date(event.scheduled_at).getTime() - new Date(alert.scheduled_for).getTime()) / 60000));
    embed = buildNewsEmbed(template, event, settings, { minutesBefore });
  }
  const components = buildButtonRows(template.buttons || []);
  const message = await channelCheck.channel.send({
    content: channelCheck.mentionEveryone ? '@everyone' : '',
    embeds: [embed],
    components,
    allowedMentions: channelCheck.mentionEveryone ? { parse: ['everyone'] } : { parse: [] },
  });
  if (channelCheck.canAddReactions) await addReactions(message, reactions);
  else await logActivity({ type: 'news', action: 'missing_reaction_permission', source: test ? 'crm_api' : 'bot', metadata: { channelId: destinationChannelId } });
  return { messageId: message.id, channelId: destinationChannelId, mentionEveryone: channelCheck.mentionEveryone };
}

async function pollDueNewsAlerts() {
  if (newsAlertPollRunning) return;
  newsAlertPollRunning = true;
  try {
    await pool.query(
      `
      UPDATE discord_news_alerts
      SET status = 'SKIPPED', last_error = 'Alert missed stale grace period.', updated_at = NOW()
      WHERE status = 'PENDING' AND scheduled_for < NOW() - ($1::text || ' minutes')::interval
      `,
      [NEWS_STALE_ALERT_GRACE_MINUTES]
    );
    for (let i = 0; i < 5; i += 1) {
      const result = await pool.query(
        `
        UPDATE discord_news_alerts
        SET status = 'PROCESSING', attempt_count = attempt_count + 1, updated_at = NOW()
        WHERE id = (
          SELECT id
          FROM discord_news_alerts
          WHERE status = 'PENDING' AND scheduled_for <= NOW()
          ORDER BY scheduled_for ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
        `
      );
      if (!result.rowCount) break;
      const alert = result.rows[0];
      try {
        const sendResult = await sendNewsAlert(alert);
        await pool.query(
          `
          UPDATE discord_news_alerts
          SET status = 'SENT', discord_message_id = $2, sent_at = NOW(), last_error = NULL, updated_at = NOW()
          WHERE id = $1
          `,
          [alert.id, sendResult.messageId]
        );
        await logActivity({ type: 'news', action: 'alert_sent', source: 'bot', entityType: 'discord_news_alert', entityId: String(alert.id), metadata: sendResult });
      } catch (error) {
        await pool.query(
          `
          UPDATE discord_news_alerts
          SET status = 'FAILED', last_error = $2, updated_at = NOW()
          WHERE id = $1
          `,
          [alert.id, sanitizePublicErrorMessage(error)]
        );
        await logActivity({ type: 'news', action: 'alert_failed', source: 'bot', entityType: 'discord_news_alert', entityId: String(alert.id), errorMessage: sanitizePublicErrorMessage(error) });
      }
    }
  } finally {
    newsAlertPollRunning = false;
  }
}

async function startNewsSchedulers() {
  if (newsRefreshIntervalHandle) clearInterval(newsRefreshIntervalHandle);
  if (newsAlertIntervalHandle) clearInterval(newsAlertIntervalHandle);
  const settings = await getNewsSettings();
  if (settings.enabled) {
    syncNewsFeed().catch(error => console.log(`Initial news sync failed: ${error.message}`));
  }
  newsRefreshIntervalHandle = setInterval(async () => {
    const current = await getNewsSettings().catch(() => settings);
    if (current.enabled) await syncNewsFeed().catch(error => console.log(`Scheduled news sync failed: ${error.message}`));
  }, Math.max(5, Number(settings.refreshIntervalMinutes || 15)) * 60 * 1000);
  newsAlertIntervalHandle = setInterval(() => {
    pollDueNewsAlerts().catch(error => console.log(`News alert poll failed: ${error.message}`));
  }, NEWS_ALERT_POLL_MS);
}

async function getNewsOverview() {
  const settings = await getNewsSettings();
  const [
    lastSuccess,
    lastFailed,
    upcoming,
    pending,
    sentToday,
    failedToday,
    nextAlert,
    dailyLastSent,
    byImpact,
  ] = await Promise.all([
    pool.query(`SELECT * FROM discord_news_sync_logs WHERE status = 'SUCCESS' ORDER BY completed_at DESC NULLS LAST, started_at DESC LIMIT 1`),
    pool.query(`SELECT * FROM discord_news_sync_logs WHERE status = 'FAILED' ORDER BY completed_at DESC NULLS LAST, started_at DESC LIMIT 1`),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_news_events WHERE scheduled_at >= NOW() AND cancelled = false`),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_news_alerts WHERE status = 'PENDING'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_news_alerts WHERE status = 'SENT' AND sent_at >= date_trunc('day', NOW())`),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_news_alerts WHERE status = 'FAILED' AND updated_at >= date_trunc('day', NOW())`),
    pool.query(`SELECT * FROM discord_news_alerts WHERE status = 'PENDING' ORDER BY scheduled_for ASC LIMIT 1`),
    pool.query(`SELECT * FROM discord_news_alerts WHERE alert_type = 'DAILY_SUMMARY' AND status = 'SENT' ORDER BY sent_at DESC LIMIT 1`),
    pool.query(`SELECT alert_type, COUNT(*)::int AS count FROM discord_news_alerts WHERE status = 'SENT' GROUP BY alert_type`),
  ]);
  return {
    automationEnabled: settings.enabled,
    feedStatus: lastFailed.rowCount && (!lastSuccess.rowCount || new Date(lastFailed.rows[0].started_at) > new Date(lastSuccess.rows[0].started_at)) ? 'failed' : 'ok',
    lastSuccessfulSync: lastSuccess.rows[0]?.completed_at || null,
    lastError: lastFailed.rows[0]?.error_message || null,
    upcomingStoredEvents: upcoming.rows[0]?.count || 0,
    pendingAlerts: pending.rows[0]?.count || 0,
    alertsSentToday: sentToday.rows[0]?.count || 0,
    alertsFailedToday: failedToday.rows[0]?.count || 0,
    dailySummaryLastSent: dailyLastSent.rows[0]?.sent_at || null,
    highImpactAlertsSent: byImpact.rows.find(row => row.alert_type === 'HIGH_IMPACT_ADVANCE')?.count || 0,
    mediumImpactAlertsSent: byImpact.rows.find(row => row.alert_type === 'MEDIUM_IMPACT_ADVANCE')?.count || 0,
    lowImpactAlertsSent: byImpact.rows.find(row => row.alert_type === 'LOW_IMPACT_ADVANCE')?.count || 0,
    destinationChannelId: settings.destinationChannelId,
    nextScheduledAlert: nextAlert.rows[0] ? serializeNewsAlert(nextAlert.rows[0]) : null,
  };
}

function payoutRandomInt(min, max, rng = Math.random) {
  const floor = Math.ceil(Number(min));
  const ceiling = Math.floor(Number(max));
  return Math.floor(rng() * (ceiling - floor + 1)) + floor;
}

function payoutRandomChoice(values, rng = Math.random) {
  const list = Array.isArray(values) ? values.filter(value => value !== null && value !== undefined) : [];
  if (!list.length) return null;
  return list[payoutRandomInt(0, list.length - 1, rng)];
}

function getTimeZoneOffsetMs(date, timezone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return asUtc - date.getTime();
}

function zonedTimeToUtc(year, month, day, hour, minute, timezone = 'Europe/London') {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let offset = getTimeZoneOffsetMs(new Date(utc), timezone);
  utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset;
  offset = getTimeZoneOffsetMs(new Date(utc), timezone);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset);
}

function localDateParts(date, timezone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: String(values.weekday || '').toUpperCase(),
  };
}

function localWeekRange(date = new Date(), timezone = 'Europe/London') {
  const parts = localDateParts(date, timezone);
  const weekdayIndex = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].indexOf(parts.weekday);
  const daysSinceMonday = weekdayIndex === 0 ? 6 : Math.max(0, weekdayIndex - 1);
  const mondayNoon = zonedTimeToUtc(parts.year, parts.month, parts.day, 12, 0, timezone);
  mondayNoon.setUTCDate(mondayNoon.getUTCDate() - daysSinceMonday);
  const mondayParts = localDateParts(mondayNoon, timezone);
  const weekStart = zonedTimeToUtc(mondayParts.year, mondayParts.month, mondayParts.day, 0, 0, timezone);
  const weekEnd = new Date(weekStart.getTime());
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  return { weekStart, weekEnd };
}

function flagFromCountryCode(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';
  return code.replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function discordFlagCode(countryCode) {
  const code = String(countryCode || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? `:flag_${code}:` : ':earth_africa:';
}

function payoutCountryName(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return 'Unknown';
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(code) || code;
  } catch (_) {
    return code;
  }
}

function formatPayoutAmount(amount, currency = 'USD') {
  const value = Number(amount || 0);
  const safeCurrency = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (_) {
    return `${safeCurrency} ${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
  }
}

function formatPayoutRewardAmount(amount, currency = 'USD') {
  const value = Number(amount || 0);
  const symbolMap = { USD: '$', GBP: '£', EUR: '€' };
  const safeCurrency = String(currency || 'USD').toUpperCase();
  const symbol = symbolMap[safeCurrency] || `${safeCurrency} `;
  return `${symbol}${value.toFixed(3)}`;
}

function payoutTemplateValues(row = {}) {
  const countryCode = String(row.country_code || row.countryCode || 'GB').trim().toUpperCase();
  const currency = String(row.currency || 'USD').trim().toUpperCase();
  const amount = Number(row.amount || 0);
  return {
    flag: row.flag || flagFromCountryCode(countryCode),
    flag_code: discordFlagCode(countryCode),
    display_name: row.display_name || row.displayName || 'TTT Trader',
    formatted_amount: formatPayoutAmount(amount, currency),
    reward_amount: formatPayoutRewardAmount(amount, currency),
    amount,
    currency,
    country_code: countryCode,
    country_name: row.country_name || row.countryName || payoutCountryName(countryCode),
  };
}

function renderUniformPayoutMessage(row = {}) {
  return renderPayoutTemplate(DEFAULT_PAYOUT_MESSAGE_TEMPLATE, payoutTemplateValues(row));
}

function normalizeCountryCode(value, fallback = 'GB') {
  const code = String(value || fallback || 'GB').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : 'GB';
}

function sanitizeLivePayoutPayload(body = {}) {
  const amount = Number(body.amount ?? body.rewardAmount ?? body.payoutAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw createApiError('LIVE_PAYOUT_AMOUNT_REQUIRED', 'Live payout amount must be greater than zero.', 400);
  const countryCode = normalizeCountryCode(body.countryCode || body.country_code || body.country || 'GB');
  const currency = /^[A-Z]{3}$/.test(String(body.currency || 'USD').toUpperCase()) ? String(body.currency || 'USD').toUpperCase() : 'USD';
  const externalPayoutId = String(body.externalPayoutId || body.external_payout_id || body.payoutId || body.id || `live_${Date.now()}`).trim();
  return {
    externalPayoutId,
    firstName: String(body.firstName || body.first_name || '').trim() || null,
    lastName: String(body.lastName || body.last_name || '').trim() || null,
    displayName: String(body.displayName || body.display_name || '').trim() || 'TTT Trader',
    countryCode,
    countryName: String(body.countryName || body.country_name || payoutCountryName(countryCode)).trim(),
    flag: discordFlagCode(countryCode),
    amount,
    currency,
    scheduledFor: body.scheduledFor || body.scheduled_for ? new Date(String(body.scheduledFor || body.scheduled_for)) : new Date(),
  };
}

function renderPayoutTemplate(template, values = {}) {
  return String(template || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return values[key] === undefined || values[key] === null ? '' : String(values[key]);
  }).replace(/[ \t]+/g, ' ').trim();
}

function normalizePayoutSettings(settings = {}) {
  const merged = { ...DEFAULT_PAYOUT_SETTINGS, ...settings };
  const weeklyMinimum = Math.max(1, Math.min(Number(merged.weeklyMinimum || 20), 500));
  const weeklyMaximum = Math.max(weeklyMinimum, Math.min(Number(merged.weeklyMaximum || 50), 500));
  const minimumIntervalMinutes = Math.max(1, Math.min(Number(merged.minimumIntervalMinutes || 10), 720));
  const maximumIntervalMinutes = Math.max(minimumIntervalMinutes, Math.min(Number(merged.maximumIntervalMinutes || 95), 720));
  const selectedCountries = Array.isArray(merged.simulationSelectedCountries)
    ? Array.from(new Set(merged.simulationSelectedCountries.map(value => String(value).trim().toUpperCase()).filter(value => /^[A-Z]{2}$/.test(value))))
    : DEFAULT_PAYOUT_COUNTRIES;
  const postingDays = Array.isArray(merged.postingDays)
    ? merged.postingDays.map(value => String(value).trim().toUpperCase()).filter(value => PAYOUT_POSTING_DAYS.includes(value))
    : PAYOUT_POSTING_DAYS;
  return {
    ...merged,
    mode: PAYOUT_FEED_MODES.has(String(merged.mode || '').toUpperCase()) ? String(merged.mode).toUpperCase() : 'DISABLED',
    enabled: Boolean(merged.enabled),
    postingDays: postingDays.length ? postingDays : PAYOUT_POSTING_DAYS,
    weeklyMinimum,
    weeklyMaximum,
    minimumIntervalMinutes,
    maximumIntervalMinutes,
    simulationMinAmount: Math.max(0, Number(merged.simulationMinAmount || 25)),
    simulationMaxAmount: Math.max(Number(merged.simulationMinAmount || 25), Number(merged.simulationMaxAmount || 2500)),
    simulationSelectedCountries: selectedCountries.length ? selectedCountries : DEFAULT_PAYOUT_COUNTRIES,
    defaultCurrency: /^[A-Z]{3}$/.test(String(merged.defaultCurrency || '').toUpperCase()) ? String(merged.defaultCurrency).toUpperCase() : 'USD',
  };
}

function parsePayoutTimeMinutes(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Math.max(0, Math.min(Number(match[1]), 23));
  const minutes = Math.max(0, Math.min(Number(match[2]), 59));
  return hours * 60 + minutes;
}

function buildPayoutScheduleForDay({ dateParts, count, settings, rng = Math.random }) {
  const normalized = normalizePayoutSettings(settings);
  const start = parsePayoutTimeMinutes(normalized.postingWindowStart, 10 * 60);
  const end = Math.max(start + 1, parsePayoutTimeMinutes(normalized.postingWindowEnd, 22 * 60));
  const span = end - start;
  const times = [];
  let previous = null;

  for (let index = 0; index < count; index += 1) {
    const evenMinute = start + Math.floor(((index + 0.5) * span) / Math.max(1, count));
    const jitterLimit = Math.min(normalized.maximumIntervalMinutes, Math.max(normalized.minimumIntervalMinutes, Math.floor(span / Math.max(2, count))));
    const jitter = normalized.randomiseTiming ? payoutRandomInt(-jitterLimit, jitterLimit, rng) : 0;
    let minuteOfDay = Math.max(start, Math.min(end, evenMinute + jitter));
    if (previous !== null && minuteOfDay - previous < normalized.minimumIntervalMinutes) {
      minuteOfDay = Math.min(end, previous + normalized.minimumIntervalMinutes);
    }
    previous = minuteOfDay;
    times.push(zonedTimeToUtc(
      dateParts.year,
      dateParts.month,
      dateParts.day,
      Math.floor(minuteOfDay / 60),
      minuteOfDay % 60,
      normalized.timezone
    ));
  }

  return times.sort((a, b) => a.getTime() - b.getTime());
}

function payoutDisplayName(firstName, rng = Math.random, mode = 'FIRST_INITIAL') {
  const first = firstName || payoutRandomChoice(PAYOUT_NAME_POOL, rng) || 'Trader';
  if (mode === 'ANONYMOUS') return 'TTT Trader';
  if (mode === 'FIRST_NAME') return first;
  return `${first} ${payoutRandomChoice(PAYOUT_INITIALS, rng) || 'T'}.`;
}

function generatePayoutWeekPlanPure(settings = {}, options = {}) {
  const normalized = normalizePayoutSettings(settings);
  const rng = options.rng || Math.random;
  const now = options.now ? new Date(options.now) : new Date();
  const { weekStart, weekEnd } = localWeekRange(now, normalized.timezone);
  const weeklyTarget = Number(options.weeklyTarget || payoutRandomInt(normalized.weeklyMinimum, normalized.weeklyMaximum, rng));
  const wednesdayTarget = Math.max(1, Math.min(weeklyTarget - 1, payoutRandomInt(Math.floor(weeklyTarget * 0.4), Math.ceil(weeklyTarget * 0.6), rng)));
  const thursdayTarget = weeklyTarget - wednesdayTarget;
  const baseLocal = localDateParts(weekStart, normalized.timezone);
  const mondayNoon = zonedTimeToUtc(baseLocal.year, baseLocal.month, baseLocal.day, 12, 0, normalized.timezone);
  const wednesday = new Date(mondayNoon.getTime());
  wednesday.setUTCDate(wednesday.getUTCDate() + 2);
  const thursday = new Date(mondayNoon.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const templates = Array.isArray(options.templates) && options.templates.length ? options.templates : DEFAULT_PAYOUT_TEMPLATES.map((bodyTemplate, index) => ({ id: null, name: `Default ${index + 1}`, bodyTemplate }));
  const schedule = [
    ...buildPayoutScheduleForDay({ dateParts: localDateParts(wednesday, normalized.timezone), count: wednesdayTarget, settings: normalized, rng }),
    ...buildPayoutScheduleForDay({ dateParts: localDateParts(thursday, normalized.timezone), count: thursdayTarget, settings: normalized, rng }),
  ].sort((a, b) => a.getTime() - b.getTime());
  let lastTemplateIndex = -1;

  const items = schedule.map((scheduledFor, index) => {
    const countryCode = payoutRandomChoice(normalized.simulationSelectedCountries, rng) || 'GB';
    const currency = normalized.simulationCurrencyMode === 'RANDOM'
      ? payoutRandomChoice(PAYOUT_CURRENCIES, rng)
      : normalized.defaultCurrency;
    const rawAmount = normalized.simulationMinAmount + rng() * (normalized.simulationMaxAmount - normalized.simulationMinAmount);
    const amount = normalized.simulationDecimalVariation ? Number(rawAmount.toFixed(2)) : Math.round(rawAmount);
    const firstName = payoutRandomChoice(PAYOUT_NAME_POOL, rng);
    let templateIndex = payoutRandomInt(0, templates.length - 1, rng);
    if (templates.length > 1 && normalized.simulationTemplateRotation && templateIndex === lastTemplateIndex) {
      templateIndex = (templateIndex + 1) % templates.length;
    }
    lastTemplateIndex = templateIndex;
    const template = templates[templateIndex];
    const values = {
      flag: flagFromCountryCode(countryCode),
      flag_code: discordFlagCode(countryCode),
      country_code: countryCode,
      country_name: payoutCountryName(countryCode),
      first_name: firstName,
      display_name: payoutDisplayName(firstName, rng, normalized.simulationNameMode),
      amount,
      currency,
      formatted_amount: formatPayoutAmount(amount, currency),
      reward_amount: formatPayoutRewardAmount(amount, currency),
    };
    return {
      sourceType: 'SIMULATION',
      isSimulated: true,
      externalPayoutId: `sim_${localDateKey(weekStart, normalized.timezone).replace(/-/g, '')}_${String(index + 1).padStart(3, '0')}_${crypto.randomBytes(3).toString('hex')}`,
      firstName,
      lastName: null,
      displayName: values.display_name,
      countryCode,
      countryName: values.country_name,
      flag: values.flag,
      amount,
      currency,
      scheduledFor,
      templateId: template.id || null,
      templateName: template.name || null,
      message: renderUniformPayoutMessage(values),
    };
  });

  return {
    mode: normalized.mode,
    weekStart,
    weekEnd,
    weeklyTarget,
    wednesdayTarget,
    thursdayTarget,
    items,
  };
}

function normalizePayoutSettingsRow(row) {
  if (!row) return normalizePayoutSettings(DEFAULT_PAYOUT_SETTINGS);
  return normalizePayoutSettings({
    mode: row.mode,
    enabled: row.enabled,
    destinationChannelId: row.destination_channel_id || null,
    timezone: row.timezone,
    postingDays: row.posting_days,
    postingWindowStart: row.posting_window_start,
    postingWindowEnd: row.posting_window_end,
    weeklyMinimum: row.weekly_minimum,
    weeklyMaximum: row.weekly_maximum,
    minimumIntervalMinutes: row.minimum_interval_minutes,
    maximumIntervalMinutes: row.maximum_interval_minutes,
    randomiseTiming: row.randomise_timing,
    simulationEnabled: row.simulation_enabled,
    simulationNameMode: row.simulation_name_mode,
    simulationCurrencyMode: row.simulation_currency_mode,
    simulationMinAmount: row.simulation_min_amount,
    simulationMaxAmount: row.simulation_max_amount,
    simulationDecimalVariation: row.simulation_decimal_variation,
    simulationSelectedCountries: row.simulation_selected_countries,
    simulationTemplateRotation: row.simulation_template_rotation,
    defaultCurrency: row.default_currency,
    updatedBy: row.updated_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  });
}

async function getPayoutFeedSettings() {
  const result = await pool.query(`SELECT * FROM discord_payout_feed_settings WHERE id = 1`);
  if (!result.rowCount) {
    await pool.query(
      `INSERT INTO discord_payout_feed_settings (id, destination_channel_id) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_PAYOUT_SETTINGS.destinationChannelId]
    );
    return normalizePayoutSettings(DEFAULT_PAYOUT_SETTINGS);
  }
  return normalizePayoutSettingsRow(result.rows[0]);
}

function sanitizePayoutSettingsPatch(body = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'mode')) {
    const mode = String(body.mode || '').toUpperCase();
    if (!PAYOUT_FEED_MODES.has(mode)) throw createApiError('PAYOUT_MODE_INVALID', 'Payout feed mode must be DISABLED, SIMULATION or LIVE', 400);
    patch.mode = mode;
  }
  for (const key of ['enabled', 'randomiseTiming', 'simulationEnabled', 'simulationDecimalVariation', 'simulationTemplateRotation']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = toBoolean(body[key], false);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'destinationChannelId') || Object.prototype.hasOwnProperty.call(body, 'destination_channel_id')) {
    const channelId = body.destinationChannelId || body.destination_channel_id || null;
    patch.destinationChannelId = channelId ? requireDiscordId(channelId, 'Payout destination channel ID') : null;
  }
  if (body.timezone) patch.timezone = String(body.timezone).trim().slice(0, 80) || 'Europe/London';
  if (body.postingWindowStart && /^\d{1,2}:\d{2}$/.test(String(body.postingWindowStart))) patch.postingWindowStart = String(body.postingWindowStart);
  if (body.postingWindowEnd && /^\d{1,2}:\d{2}$/.test(String(body.postingWindowEnd))) patch.postingWindowEnd = String(body.postingWindowEnd);
  for (const key of ['weeklyMinimum', 'weeklyMaximum', 'minimumIntervalMinutes', 'maximumIntervalMinutes', 'simulationMinAmount', 'simulationMaxAmount']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = Number(body[key]);
  }
  if (Array.isArray(body.postingDays)) patch.postingDays = body.postingDays.map(value => String(value).toUpperCase()).filter(value => PAYOUT_POSTING_DAYS.includes(value));
  if (Array.isArray(body.simulationSelectedCountries)) patch.simulationSelectedCountries = body.simulationSelectedCountries.map(value => String(value).toUpperCase()).filter(value => /^[A-Z]{2}$/.test(value));
  if (body.simulationNameMode) patch.simulationNameMode = String(body.simulationNameMode).trim().toUpperCase();
  if (body.simulationCurrencyMode) patch.simulationCurrencyMode = String(body.simulationCurrencyMode).trim().toUpperCase();
  if (body.defaultCurrency) patch.defaultCurrency = String(body.defaultCurrency).trim().toUpperCase();
  return patch;
}

async function updatePayoutFeedSettings(patch, actor = null) {
  const current = await getPayoutFeedSettings();
  const next = normalizePayoutSettings({ ...current, ...patch });
  await pool.query(
    `
    UPDATE discord_payout_feed_settings
    SET mode = $1,
        enabled = $2,
        destination_channel_id = $3,
        timezone = $4,
        posting_days = $5::jsonb,
        posting_window_start = $6,
        posting_window_end = $7,
        weekly_minimum = $8,
        weekly_maximum = $9,
        minimum_interval_minutes = $10,
        maximum_interval_minutes = $11,
        randomise_timing = $12,
        simulation_enabled = $13,
        simulation_name_mode = $14,
        simulation_currency_mode = $15,
        simulation_min_amount = $16,
        simulation_max_amount = $17,
        simulation_decimal_variation = $18,
        simulation_selected_countries = $19::jsonb,
        simulation_template_rotation = $20,
        default_currency = $21,
        updated_by = $22,
        updated_at = NOW()
    WHERE id = 1
    RETURNING *
    `,
    [
      next.mode,
      next.enabled,
      next.destinationChannelId,
      next.timezone,
      JSON.stringify(next.postingDays),
      next.postingWindowStart,
      next.postingWindowEnd,
      next.weeklyMinimum,
      next.weeklyMaximum,
      next.minimumIntervalMinutes,
      next.maximumIntervalMinutes,
      next.randomiseTiming,
      next.simulationEnabled,
      next.simulationNameMode,
      next.simulationCurrencyMode,
      next.simulationMinAmount,
      next.simulationMaxAmount,
      next.simulationDecimalVariation,
      JSON.stringify(next.simulationSelectedCountries),
      next.simulationTemplateRotation,
      next.defaultCurrency,
      actor,
    ]
  );
  return getPayoutFeedSettings();
}

async function seedPayoutFeedTemplates() {
  for (const [index, bodyTemplate] of DEFAULT_PAYOUT_TEMPLATES.entries()) {
    await pool.query(
      `
      INSERT INTO discord_payout_feed_templates (name, enabled, weight, body_template, source_type)
      VALUES ($1, true, 1, $2, 'SIMULATION')
      ON CONFLICT (name, source_type) DO NOTHING
      `,
      [`Simulation ${index + 1}`, bodyTemplate]
    );
  }
}

function serializePayoutTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    weight: Number(row.weight || 1),
    bodyTemplate: row.body_template,
    sourceType: row.source_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializePayoutWeek(row) {
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    weeklyTarget: Number(row.weekly_target || 0),
    wednesdayTarget: Number(row.wednesday_target || 0),
    thursdayTarget: Number(row.thursday_target || 0),
    generatedCount: Number(row.generated_count || 0),
    scheduledCount: Number(row.scheduled_count || 0),
    postedCount: Number(row.posted_count || 0),
    failedCount: Number(row.failed_count || 0),
    randomSeedHash: row.random_seed_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializePayoutItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceType: row.source_type,
    isSimulated: Boolean(row.is_simulated),
    externalPayoutId: row.external_payout_id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    countryCode: row.country_code,
    countryName: row.country_name,
    flag: row.flag,
    amount: Number(row.amount || 0),
    currency: row.currency,
    formattedAmount: formatPayoutAmount(row.amount, row.currency),
    status: row.status,
    scheduledFor: row.scheduled_for,
    discordMessageId: row.discord_message_id,
    postedAt: row.posted_at,
    templateId: row.template_id,
    weekId: row.week_id,
    attemptCount: Number(row.attempt_count || 0),
    lastError: row.last_error,
    message: renderUniformPayoutMessage(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function enabledPayoutTemplates(sourceType = 'SIMULATION') {
  const result = await pool.query(
    `SELECT * FROM discord_payout_feed_templates WHERE enabled = true AND source_type = $1 ORDER BY id ASC`,
    [sourceType]
  );
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    bodyTemplate: row.body_template,
    weight: Number(row.weight || 1),
  }));
}

async function ensurePayoutWeek({ force = false, actor = null } = {}) {
  const settings = await getPayoutFeedSettings();
  if (!settings.enabled || settings.mode !== 'SIMULATION' || !settings.simulationEnabled) {
    return { skipped: true, reason: 'simulation_disabled', settings };
  }
  if (!settings.destinationChannelId) {
    return { skipped: true, reason: 'destination_channel_missing', settings };
  }
  const { weekStart, weekEnd } = localWeekRange(new Date(), settings.timezone);
  const existing = await pool.query(
    `SELECT * FROM discord_payout_feed_weeks WHERE mode = 'SIMULATION' AND week_start = $1 LIMIT 1`,
    [weekStart]
  );
  if (existing.rowCount && !force) return { week: serializePayoutWeek(existing.rows[0]), created: false, skipped: true, reason: 'already_generated' };
  if (existing.rowCount && force) {
    await pool.query(
      `
      UPDATE discord_payout_feed_items
      SET status = 'CANCELLED', last_error = 'Cancelled by regeneration', updated_at = NOW()
      WHERE week_id = $1 AND status IN ('GENERATED', 'SCHEDULED', 'FAILED', 'SKIPPED', 'CANCELLED')
      `,
      [existing.rows[0].id]
    );
  }
  const templates = await enabledPayoutTemplates('SIMULATION');
  const plan = generatePayoutWeekPlanPure(settings, { templates });
  const weekResult = existing.rowCount
    ? await pool.query(
      `
      UPDATE discord_payout_feed_weeks
      SET weekly_target = $2,
          wednesday_target = $3,
          thursday_target = $4,
          generated_count = 0,
          scheduled_count = 0,
          failed_count = 0,
          random_seed_hash = $5,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [existing.rows[0].id, plan.weeklyTarget, plan.wednesdayTarget, plan.thursdayTarget, crypto.randomBytes(12).toString('hex')]
    )
    : await pool.query(
      `
      INSERT INTO discord_payout_feed_weeks
        (mode, week_start, week_end, weekly_target, wednesday_target, thursday_target, random_seed_hash)
      VALUES ('SIMULATION', $1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [weekStart, weekEnd, plan.weeklyTarget, plan.wednesdayTarget, plan.thursdayTarget, crypto.randomBytes(12).toString('hex')]
    );
  const week = weekResult.rows[0];
  let inserted = 0;
  for (const item of plan.items) {
    await pool.query(
      `
      INSERT INTO discord_payout_feed_items
        (source_type, is_simulated, external_payout_id, first_name, last_name, display_name, country_code, country_name, flag, amount, currency, status, scheduled_for, template_id, week_id)
      VALUES ('SIMULATION', true, $1, $2, $3, $4, $5, $6, $7, $8, $9, 'SCHEDULED', $10, $11, $12)
      ON CONFLICT (external_payout_id) DO NOTHING
      `,
      [
        item.externalPayoutId,
        item.firstName,
        item.lastName,
        item.displayName,
        item.countryCode,
        item.countryName,
        item.flag,
        item.amount,
        item.currency,
        item.scheduledFor,
        item.templateId,
        week.id,
      ]
    );
    inserted += 1;
  }
  const counts = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status IN ('GENERATED','SCHEDULED','PROCESSING','POSTED'))::int AS generated,
      COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled,
      COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
      COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
    FROM discord_payout_feed_items
    WHERE week_id = $1
    `,
    [week.id]
  );
  const updatedWeek = await pool.query(
    `
    UPDATE discord_payout_feed_weeks
    SET generated_count = $2, scheduled_count = $3, posted_count = $4, failed_count = $5, updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [
      week.id,
      counts.rows[0]?.generated || 0,
      counts.rows[0]?.scheduled || 0,
      counts.rows[0]?.posted || 0,
      counts.rows[0]?.failed || 0,
    ]
  );
  await logActivity({
    type: 'payout_feed',
    action: force ? 'week_regenerated' : 'week_generated',
    actor,
    source: actor ? 'crm_api' : 'bot',
    entityType: 'discord_payout_feed_week',
    entityId: String(week.id),
    metadata: { weeklyTarget: plan.weeklyTarget, inserted },
  });
  return { week: serializePayoutWeek(updatedWeek.rows[0]), created: true, inserted };
}

async function sendPayoutFeedItem(row, { test = false, channelId = null } = {}) {
  const settings = await getPayoutFeedSettings();
  const destinationChannelId = channelId || settings.destinationChannelId;
  if (!destinationChannelId) throw createApiError('PAYOUT_CHANNEL_MISSING', 'Payout destination channel is not configured', 400);
  const content = renderUniformPayoutMessage(row).slice(0, 1800);
  const channel = await fetchTextChannel(destinationChannelId);
  const permissions = channel.permissionsFor(client.user);
  if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
    throw createApiError('PAYOUT_CHANNEL_NO_SEND_PERMISSION', 'Bot cannot send messages in the payout feed channel', 403);
  }
  const message = await channel.send({ content, allowedMentions: { parse: [] } });
  return { messageId: message.id, channelId: destinationChannelId, content, test };
}

async function refreshPayoutWeekCounts(weekId) {
  if (!weekId) return;
  const counts = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status IN ('GENERATED','SCHEDULED','PROCESSING','POSTED'))::int AS generated,
      COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled,
      COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
      COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
    FROM discord_payout_feed_items
    WHERE week_id = $1
    `,
    [weekId]
  );
  await pool.query(
    `
    UPDATE discord_payout_feed_weeks
    SET generated_count = $2, scheduled_count = $3, posted_count = $4, failed_count = $5, updated_at = NOW()
    WHERE id = $1
    `,
    [weekId, counts.rows[0]?.generated || 0, counts.rows[0]?.scheduled || 0, counts.rows[0]?.posted || 0, counts.rows[0]?.failed || 0]
  );
}

async function getCertificateFeedSettings() {
  const result = await pool.query(`SELECT * FROM discord_certificate_feed_settings WHERE id = 1`);
  if (!result.rowCount) {
    await pool.query(`INSERT INTO discord_certificate_feed_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    return { passChannelId: null, payoutChannelId: null };
  }
  return {
    passChannelId: result.rows[0].pass_channel_id || null,
    payoutChannelId: result.rows[0].payout_channel_id || null,
    updatedAt: result.rows[0].updated_at,
    updatedBy: result.rows[0].updated_by || null,
  };
}

async function updateCertificateFeedSettings(body = {}, actor = null) {
  const passChannelId = Object.prototype.hasOwnProperty.call(body, 'passChannelId') || Object.prototype.hasOwnProperty.call(body, 'pass_channel_id')
    ? (body.passChannelId || body.pass_channel_id || null)
    : undefined;
  const payoutChannelId = Object.prototype.hasOwnProperty.call(body, 'payoutChannelId') || Object.prototype.hasOwnProperty.call(body, 'payout_channel_id')
    ? (body.payoutChannelId || body.payout_channel_id || null)
    : undefined;
  const current = await getCertificateFeedSettings();
  const nextPass = passChannelId === undefined ? current.passChannelId : passChannelId ? requireDiscordId(passChannelId, 'Pass certificate channel ID') : null;
  const nextPayout = payoutChannelId === undefined ? current.payoutChannelId : payoutChannelId ? requireDiscordId(payoutChannelId, 'Payout certificate channel ID') : null;
  const result = await pool.query(
    `
    UPDATE discord_certificate_feed_settings
    SET pass_channel_id = $1, payout_channel_id = $2, updated_at = NOW(), updated_by = $3
    WHERE id = 1
    RETURNING *
    `,
    [nextPass, nextPayout, actor]
  );
  return {
    passChannelId: result.rows[0].pass_channel_id || null,
    payoutChannelId: result.rows[0].payout_channel_id || null,
    updatedAt: result.rows[0].updated_at,
    updatedBy: result.rows[0].updated_by || null,
  };
}

function certificatePayload(body = {}, type = 'pass') {
  const certificateUrl = String(body.certificateUrl || body.certificate_url || body.url || body.link || '').trim();
  if (!/^https?:\/\//i.test(certificateUrl)) throw createApiError('CERTIFICATE_URL_REQUIRED', 'Certificate URL must be a public HTTP or HTTPS link.', 400);
  const name = String(body.name || body.traderName || body.trader_name || body.customerName || 'TTT Trader').trim();
  const account = String(body.account || body.accountNumber || body.account_number || body.login || '').trim();
  const amount = body.amount || body.rewardAmount || body.payoutAmount;
  const countryCode = normalizeCountryCode(body.countryCode || body.country_code || body.country || 'GB');
  return {
    type,
    name,
    account,
    certificateUrl,
    amount: amount === undefined || amount === null || amount === '' ? null : Number(amount),
    currency: String(body.currency || 'USD').toUpperCase(),
    countryCode,
    flagCode: discordFlagCode(countryCode),
  };
}

function renderCertificateMessage(payload) {
  if (payload.type === 'payout') {
    const amount = payload.amount ? ` ${formatPayoutRewardAmount(payload.amount, payload.currency)}` : '';
    return `${payload.flagCode} Payout certificate issued for ${payload.name}${amount}. ${payload.certificateUrl}`;
  }
  return `${payload.flagCode} Challenge pass certificate issued for ${payload.name}${payload.account ? ` (${payload.account})` : ''}. ${payload.certificateUrl}`;
}

async function postCertificatePayload(type, body = {}) {
  const settings = await getCertificateFeedSettings();
  const payload = certificatePayload(body, type);
  const channelId = body.channelId || body.channel_id || (type === 'payout' ? settings.payoutChannelId : settings.passChannelId);
  if (!channelId) throw createApiError('CERTIFICATE_CHANNEL_MISSING', `${type === 'payout' ? 'Payout' : 'Pass'} certificate channel is not configured.`, 400);
  const channel = await fetchTextChannel(requireDiscordId(channelId, 'Certificate channel ID'));
  const permissions = channel.permissionsFor(client.user);
  if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
    throw createApiError('CERTIFICATE_CHANNEL_NO_SEND_PERMISSION', 'Bot cannot send messages in the certificate channel.', 403);
  }
  const content = renderCertificateMessage(payload).slice(0, 1800);
  const message = await channel.send({ content, allowedMentions: { parse: [] } });
  await logActivity({ type: 'certificate_feed', action: `${type}_certificate_posted`, source: 'crm_api', metadata: { channelId: channel.id, messageId: message.id, certificateUrl: payload.certificateUrl } });
  return { sent: true, messageId: message.id, channelId: channel.id, content, payload };
}

function normalizeZealySubdomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?zealy\.io\/cw\//i, '').replace(/[^a-z0-9_-]/g, '');
}

function normalizeZealySettings(row = {}) {
  return {
    ...ZEALY_DEFAULT_SETTINGS,
    enabled: toBoolean(row.enabled, ZEALY_DEFAULT_SETTINGS.enabled),
    communitySubdomain: normalizeZealySubdomain(row.community_subdomain || row.communitySubdomain || ''),
    leaderboardEnabled: toBoolean(row.leaderboard_enabled ?? row.leaderboardEnabled, ZEALY_DEFAULT_SETTINGS.leaderboardEnabled),
    leaderboardChannelId: row.leaderboard_channel_id || row.leaderboardChannelId || null,
    leaderboardScope: String(row.leaderboard_scope || row.leaderboardScope || ZEALY_DEFAULT_SETTINGS.leaderboardScope).toUpperCase(),
    leaderboardLimit: Math.min(25, Math.max(5, Number(row.leaderboard_limit || row.leaderboardLimit || ZEALY_DEFAULT_SETTINGS.leaderboardLimit))),
    leaderboardRefreshMinutes: Math.max(10, Number(row.leaderboard_refresh_minutes || row.leaderboardRefreshMinutes || ZEALY_DEFAULT_SETTINGS.leaderboardRefreshMinutes)),
    leaderboardMessageId: row.leaderboard_message_id || row.leaderboardMessageId || null,
    leaderboardIncludeSprint: toBoolean(row.leaderboard_include_sprint ?? row.leaderboardIncludeSprint, true),
    leaderboardShowXp: toBoolean(row.leaderboard_show_xp ?? row.leaderboardShowXp, true),
    leaderboardShowRank: toBoolean(row.leaderboard_show_rank ?? row.leaderboardShowRank, true),
    leaderboardShowDiscordNames: toBoolean(row.leaderboard_show_discord_names ?? row.leaderboardShowDiscordNames, true),
    leaderboardShowStats: toBoolean(row.leaderboard_show_stats ?? row.leaderboardShowStats, true),
    rewardFeedEnabled: toBoolean(row.reward_feed_enabled ?? row.rewardFeedEnabled, ZEALY_DEFAULT_SETTINGS.rewardFeedEnabled),
    rewardFeedChannelId: row.reward_feed_channel_id || row.rewardFeedChannelId || null,
    rewardFeedPollMinutes: Math.max(5, Number(row.reward_feed_poll_minutes || row.rewardFeedPollMinutes || ZEALY_DEFAULT_SETTINGS.rewardFeedPollMinutes)),
    rewardFeedEventToggles: { ...ZEALY_DEFAULT_SETTINGS.rewardFeedEventToggles, ...(row.reward_feed_event_toggles || row.rewardFeedEventToggles || {}) },
    rewardFeedMilestones: normalizeZealyMilestones(row.reward_feed_milestones || row.rewardFeedMilestones || ZEALY_DEFAULT_MILESTONES),
    rewardFeedMilestoneMode: String(row.reward_feed_milestone_mode || row.rewardFeedMilestoneMode || 'HIGHEST_ONLY').toUpperCase() === 'ALL' ? 'ALL' : 'HIGHEST_ONLY',
    lastSyncAt: row.last_sync_at || row.lastSyncAt || null,
    lastWebhookAt: row.last_webhook_at || row.lastWebhookAt || null,
    lastError: row.last_error || row.lastError || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    updatedBy: row.updated_by || row.updatedBy || null,
  };
}

function normalizeZealyMilestones(values) {
  const list = Array.isArray(values) ? values : String(values || '').split(/[,\n]/);
  return [...new Set(list.map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b)
    .slice(0, 100);
}

async function getZealySettings() {
  const result = await pool.query(`SELECT * FROM discord_zealy_settings WHERE id = 1`);
  if (!result.rowCount) {
    await pool.query(`INSERT INTO discord_zealy_settings (id, reward_feed_event_toggles, reward_feed_milestones) VALUES (1, $1::jsonb, $2::jsonb) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(ZEALY_DEFAULT_SETTINGS.rewardFeedEventToggles), JSON.stringify(ZEALY_DEFAULT_MILESTONES)]);
    return normalizeZealySettings({});
  }
  return normalizeZealySettings(result.rows[0]);
}

async function updateZealySettings(body = {}, actor = null) {
  const current = await getZealySettings();
  const next = normalizeZealySettings({ ...current, ...body });
  const subdomain = Object.prototype.hasOwnProperty.call(body, 'communitySubdomain') || Object.prototype.hasOwnProperty.call(body, 'community_subdomain')
    ? normalizeZealySubdomain(body.communitySubdomain || body.community_subdomain)
    : next.communitySubdomain;
  const result = await pool.query(
    `
    UPDATE discord_zealy_settings
    SET enabled = $1,
        community_subdomain = $2,
        leaderboard_enabled = $3,
        leaderboard_channel_id = $4,
        leaderboard_scope = $5,
        leaderboard_limit = $6,
        leaderboard_refresh_minutes = $7,
        leaderboard_message_id = $8,
        leaderboard_include_sprint = $9,
        leaderboard_show_xp = $10,
        leaderboard_show_rank = $11,
        leaderboard_show_discord_names = $12,
        leaderboard_show_stats = $13,
        reward_feed_enabled = $14,
        reward_feed_channel_id = $15,
        reward_feed_poll_minutes = $16,
        reward_feed_event_toggles = $17::jsonb,
        reward_feed_milestones = $18::jsonb,
        reward_feed_milestone_mode = $19,
        updated_by = $20,
        updated_at = NOW()
    WHERE id = 1
    RETURNING *
    `,
    [
      next.enabled,
      subdomain,
      next.leaderboardEnabled,
      next.leaderboardChannelId ? requireDiscordId(next.leaderboardChannelId, 'Leaderboard channel ID') : null,
      next.leaderboardScope,
      next.leaderboardLimit,
      next.leaderboardRefreshMinutes,
      next.leaderboardMessageId || null,
      next.leaderboardIncludeSprint,
      next.leaderboardShowXp,
      next.leaderboardShowRank,
      next.leaderboardShowDiscordNames,
      next.leaderboardShowStats,
      next.rewardFeedEnabled,
      next.rewardFeedChannelId ? requireDiscordId(next.rewardFeedChannelId, 'Reward feed channel ID') : null,
      next.rewardFeedPollMinutes,
      JSON.stringify(next.rewardFeedEventToggles),
      JSON.stringify(next.rewardFeedMilestones),
      next.rewardFeedMilestoneMode,
      actor,
    ]
  );
  return normalizeZealySettings(result.rows[0]);
}

function safeJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

function zealyApiPath(path, query = {}) {
  const cleaned = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  const url = new URL(`${ZEALY_DEFAULT_API_BASE_URL}${cleaned}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function getZealyClientConfig() {
  const settings = await getZealySettings();
  const apiKey = await getStoredSecretValue('ZEALY_API_KEY');
  const secretSubdomain = await getStoredSecretValue('ZEALY_COMMUNITY_SUBDOMAIN');
  const baseUrlSecret = await getStoredSecretValue('ZEALY_API_BASE_URL');
  const baseUrl = /^https:\/\//i.test(String(baseUrlSecret || '')) ? String(baseUrlSecret).replace(/\/+$/, '') : ZEALY_DEFAULT_API_BASE_URL;
  const subdomain = normalizeZealySubdomain(settings.communitySubdomain || secretSubdomain);
  if (!apiKey) throw createApiError('ZEALY_API_KEY_MISSING', 'Zealy API key is not configured.', 400);
  if (!subdomain) throw createApiError('ZEALY_SUBDOMAIN_MISSING', 'Zealy community subdomain is not configured.', 400);
  return { apiKey, subdomain, baseUrl, settings };
}

async function zealyFetch(path, { query = {}, timeoutMs = ZEALY_FETCH_TIMEOUT_MS } = {}) {
  const { apiKey, subdomain, baseUrl } = await getZealyClientConfig();
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}${String(path).replace('{subdomain}', encodeURIComponent(subdomain))}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        accept: 'application/json',
        'user-agent': ZEALY_USER_AGENT,
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const retryAfter = response.headers.get('retry-after');
    const text = await response.text();
    if (!contentType.includes('application/json')) {
      throw createApiError('ZEALY_NON_JSON_RESPONSE', `Zealy returned ${response.status} ${response.statusText || 'non-JSON response'}.`, response.ok ? 502 : response.status);
    }
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = createApiError('ZEALY_API_ERROR', `Zealy API returned ${response.status}.`, response.status);
      error.details = { status: response.status, retryAfter };
      throw error;
    }
    return { json, retryAfter, url: url.toString().replace(apiKey, '***') };
  } catch (error) {
    if (error.name === 'AbortError') throw createApiError('ZEALY_TIMEOUT', 'Zealy API request timed out.', 504);
    if (error instanceof SyntaxError) throw createApiError('ZEALY_INVALID_JSON', 'Zealy returned invalid JSON.', 502);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeZealyList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  if (Array.isArray(payload?.data?.leaderboard)) return payload.data.leaderboard;
  if (Array.isArray(payload?.data?.members)) return payload.data.members;
  if (Array.isArray(payload?.data?.users)) return payload.data.users;
  if (Array.isArray(payload?.leaderboard)) return payload.leaderboard;
  if (Array.isArray(payload?.leaderboard?.items)) return payload.leaderboard.items;
  if (Array.isArray(payload?.leaderboard?.data)) return payload.leaderboard.data;
  if (Array.isArray(payload?.leaderboard?.results)) return payload.leaderboard.results;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.members)) return payload.members;
  if (Array.isArray(payload?.users)) return payload.users;
  if (Array.isArray(payload?.rankings)) return payload.rankings;
  return [];
}

function normalizeZealyLeaderboard(payload, { sprint = false } = {}) {
  return normalizeZealyList(payload).map((item, index) => {
    const user = item.user || item.member || item.account || item.profile || {};
    const discord = item.discord || user.discord || item.socials?.discord || {};
    const zealyUserId = String(item.userId || item.zealyUserId || item.id || user.id || user.userId || '').trim();
    const discordUserId = String(item.discordId || item.discordUserId || discord.id || user.discordId || '').trim() || null;
    const discordUsername = item.discordHandle || item.discordUsername || discord.handle || discord.username || user.discordHandle || user.discordUsername || null;
    const xp = Number(item.xp ?? item.score ?? item.points ?? item.totalXp ?? item.totalXP ?? item.experience ?? user.xp ?? 0);
    return {
      zealyUserId,
      zealyName: item.name || item.zealyName || user.name || item.username || user.username || null,
      discordUserId,
      discordUsername,
      xp: Number.isFinite(xp) ? xp : 0,
      rank: Number(item.rank || item.position || item.place || index + 1),
      sprintXp: sprint ? (Number.isFinite(xp) ? xp : 0) : null,
      sprintRank: sprint ? Number(item.rank || item.position || item.place || index + 1) : null,
      avatarUrl: item.avatar || item.avatarUrl || user.avatar || user.avatarUrl || null,
      rawPayload: item,
    };
  }).filter(row => row.zealyUserId);
}

async function fetchZealyLeaderboard({ sprintId = null, limit = 25 } = {}) {
  const query = { page: 0, limit };
  if (sprintId) query.sprintId = sprintId;
  const result = await zealyFetch('/public/communities/{subdomain}/leaderboard', { query });
  let rows = normalizeZealyLeaderboard(result.json, { sprint: Boolean(sprintId) });
  if (!rows.length) {
    const fallback = await zealyFetch('/public/communities/{subdomain}/leaderboard', { query: { ...query, page: 1 } }).catch(() => null);
    if (fallback) rows = normalizeZealyLeaderboard(fallback.json, { sprint: Boolean(sprintId) });
  }
  return rows;
}

async function fetchZealySprints({ onlyCurrent = true } = {}) {
  const result = await zealyFetch('/public/communities/{subdomain}/leaderboard/sprint', { query: { onlyCurrent } });
  return normalizeZealyList(result.json);
}

async function fetchZealyWebhookTypes() {
  const result = await zealyFetch('/public/communities/{subdomain}/webhooks-event-types');
  return normalizeZealyList(result.json).map(item => typeof item === 'string' ? item : item.eventType || item.type || item.name).filter(Boolean);
}

async function testZealyConnection() {
  const [leaderboard, sprints, webhookTypes] = await Promise.all([
    fetchZealyLeaderboard({ limit: 5 }).catch(error => ({ error })),
    fetchZealySprints({ onlyCurrent: true }).catch(error => ({ error })),
    fetchZealyWebhookTypes().catch(error => ({ error })),
  ]);
  return {
    ok: !leaderboard.error,
    leaderboardAvailable: !leaderboard.error,
    sprintAvailable: !sprints.error,
    webhookEventTypesAvailable: !webhookTypes.error,
    leaderboardSampleCount: Array.isArray(leaderboard) ? leaderboard.length : 0,
    currentSprint: Array.isArray(sprints) ? sprints[0] || null : null,
    webhookEventTypes: Array.isArray(webhookTypes) ? webhookTypes : [],
    errors: [leaderboard.error, sprints.error, webhookTypes.error].filter(Boolean).map(error => sanitizePublicErrorMessage(error)),
    capabilityMatrix: zealyCapabilityMatrix(Array.isArray(webhookTypes) ? webhookTypes : []),
  };
}

function zealyCapabilityMatrix(webhookTypes = []) {
  const hasWebhook = (needle) => webhookTypes.some(type => String(type).toLowerCase().includes(needle));
  return [
    { capability: 'leaderboard', status: 'supported', source: 'API', route: 'GET /public/communities/{subdomain}/leaderboard' },
    { capability: 'sprint leaderboard', status: 'supported when sprint exists', source: 'API', route: 'GET /public/communities/{subdomain}/leaderboard?sprintId=...' },
    { capability: 'current sprint', status: 'supported', source: 'API', route: 'GET /public/communities/{subdomain}/leaderboard/sprint?onlyCurrent=true' },
    { capability: 'members', status: 'supported from leaderboard and user lookup', source: 'API', route: 'GET /public/communities/{subdomain}/users/{userId}' },
    { capability: 'XP changes', status: hasWebhook('xp') ? 'webhook-supported' : 'inferred safely from leaderboard deltas', source: hasWebhook('xp') ? 'WEBHOOK' : 'POLL_DELTA' },
    { capability: 'quest completions', status: hasWebhook('quest') ? 'webhook-supported' : 'not inferred without quest identity', source: hasWebhook('quest') ? 'WEBHOOK' : 'UNAVAILABLE' },
    { capability: 'reward claims/redemptions', status: hasWebhook('reward') || hasWebhook('shop') ? 'webhook-supported' : 'not inferred without reward context', source: hasWebhook('reward') || hasWebhook('shop') ? 'WEBHOOK' : 'UNAVAILABLE' },
    { capability: 'manual XP changes', status: hasWebhook('xp') ? 'webhook-supported if emitted' : 'generic XP delta only', source: hasWebhook('xp') ? 'WEBHOOK' : 'POLL_DELTA' },
    { capability: 'Discord-linked identity', status: 'supported where Zealy returns discordId/discordHandle', source: 'API/WEBHOOK' },
  ];
}

function zealyDisplayName(row = {}) {
  if (row.discord_user_id || row.discordUserId) return `<@${row.discord_user_id || row.discordUserId}>`;
  return row.discord_username || row.discordUsername || row.zealy_name || row.zealyName || 'A TTT Markets community member';
}

function renderZealyTemplateString(template, values = {}) {
  return String(template || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return values[key] === undefined || values[key] === null ? '' : String(values[key]);
  });
}

function zealyEventValues(event = {}) {
  const metadata = event.metadata || {};
  const xpDelta = Number(event.xp_delta ?? event.xpDelta ?? 0);
  const rank = event.rank_after ?? event.rankAfter ?? event.rank;
  const previousRank = event.rank_before ?? event.rankBefore ?? '';
  return {
    zealy_name: event.zealy_name || event.zealyName || metadata.zealyName || '',
    discord_name: event.discord_username || event.discordUsername || metadata.discordUsername || '',
    user_display: event.user_display || event.userDisplay || zealyDisplayName(event),
    quest_name: event.quest_name || event.questName || metadata.questName || 'a Zealy quest',
    quest_type: event.quest_type || event.questType || metadata.questType || '',
    xp_delta: Math.abs(xpDelta),
    formatted_xp_delta: xpDelta > 0 ? `+${xpDelta}` : String(xpDelta),
    current_xp: event.current_xp ?? event.currentXp ?? metadata.currentXp ?? '',
    rank: rank || '',
    previous_rank: previousRank,
    rank_change: previousRank && rank ? Number(previousRank) - Number(rank) : '',
    reward_name: event.reward_name || event.rewardName || metadata.rewardName || '',
    reward_name_or_default: event.reward_name || event.rewardName || metadata.rewardName || 'Reward claimed in Zealy.',
    milestone: event.milestone || metadata.milestone || '',
    sprint_name: event.sprint_name || event.sprintName || metadata.sprintName || '',
    community_name: metadata.communityName || BRAND_NAME,
    discord_time: `<t:${Math.floor(new Date(event.occurred_at || event.occurredAt || Date.now()).getTime() / 1000)}:R>`,
    zealy_url: metadata.zealyUrl || 'https://zealy.io',
  };
}

async function seedZealyTemplates() {
  for (const template of ZEALY_DEFAULT_TEMPLATES) {
    await pool.query(
      `
      INSERT INTO discord_zealy_templates
        (name, event_type, title_template, body_template, colour, is_seeded)
      SELECT $1, $2, $3, $4, '#f35023', true
      WHERE NOT EXISTS (
        SELECT 1 FROM discord_zealy_templates WHERE event_type = $2 AND is_seeded = true
      )
      `,
      [template.name, template.eventType, template.titleTemplate, template.bodyTemplate]
    );
  }
}

function serializeZealyTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    eventType: row.event_type,
    enabled: row.enabled,
    titleTemplate: row.title_template,
    bodyTemplate: row.body_template,
    colour: row.colour,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
    footerText: row.footer_text,
    buttons: row.buttons || [],
    reactions: row.reactions || [],
    isSeeded: row.is_seeded,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function serializeZealyEvent(row) {
  return {
    id: row.id,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    source: row.source,
    zealyUserId: row.zealy_user_id,
    discordUserId: row.discord_user_id,
    questId: row.quest_id,
    questName: row.quest_name,
    xpDelta: row.xp_delta,
    currentXp: row.current_xp,
    rankBefore: row.rank_before,
    rankAfter: row.rank_after,
    rewardName: row.reward_name,
    metadata: row.metadata || {},
    occurredAt: row.occurred_at,
    processedAt: row.processed_at,
    discordChannelId: row.discord_channel_id,
    discordMessageId: row.discord_message_id,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeZealyMember(row) {
  return {
    zealyUserId: row.zealy_user_id,
    zealyName: row.zealy_name,
    discordUserId: row.discord_user_id,
    discordUsername: row.discord_username,
    xp: row.xp,
    rank: row.rank,
    sprintXp: row.sprint_xp,
    sprintRank: row.sprint_rank,
    avatarUrl: row.avatar_url,
    updatedAt: row.updated_at,
  };
}

async function upsertZealyMembers(members, { sprint = false, settings = ZEALY_DEFAULT_SETTINGS } = {}) {
  const previous = new Map((await pool.query(`SELECT * FROM discord_zealy_members`)).rows.map(row => [row.zealy_user_id, row]));
  const events = [];
  for (const member of members) {
    const before = previous.get(member.zealyUserId);
    await pool.query(
      `
      INSERT INTO discord_zealy_members
        (zealy_user_id, zealy_name, discord_user_id, discord_username, xp, rank, sprint_xp, sprint_rank, avatar_url, raw_payload, last_seen_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
      ON CONFLICT (zealy_user_id)
      DO UPDATE SET zealy_name = EXCLUDED.zealy_name,
                    discord_user_id = COALESCE(EXCLUDED.discord_user_id, discord_zealy_members.discord_user_id),
                    discord_username = COALESCE(EXCLUDED.discord_username, discord_zealy_members.discord_username),
                    xp = EXCLUDED.xp,
                    rank = EXCLUDED.rank,
                    sprint_xp = COALESCE(EXCLUDED.sprint_xp, discord_zealy_members.sprint_xp),
                    sprint_rank = COALESCE(EXCLUDED.sprint_rank, discord_zealy_members.sprint_rank),
                    avatar_url = COALESCE(EXCLUDED.avatar_url, discord_zealy_members.avatar_url),
                    raw_payload = EXCLUDED.raw_payload,
                    last_seen_at = NOW(),
                    updated_at = NOW()
      `,
      [member.zealyUserId, member.zealyName, member.discordUserId, member.discordUsername, member.xp, member.rank, member.sprintXp, member.sprintRank, member.avatarUrl, JSON.stringify(member.rawPayload || {})]
    );
    events.push(...detectZealyDeltaEvents(before, member, settings));
  }
  return events;
}

function detectZealyDeltaEvents(before, after, settings = ZEALY_DEFAULT_SETTINGS) {
  if (!after?.zealyUserId) return [];
  const occurredAt = new Date();
  if (!before) {
    return [{
      providerEventId: `poll:new-member:${after.zealyUserId}`,
      eventType: 'NEW_MEMBER_JOINED',
      source: 'POLL_DELTA',
      zealyUserId: after.zealyUserId,
      discordUserId: after.discordUserId,
      currentXp: after.xp,
      rankAfter: after.rank,
      metadata: { zealyName: after.zealyName, discordUsername: after.discordUsername },
      occurredAt,
    }];
  }
  const events = [];
  const xpBefore = Number(before.xp || 0);
  const xpAfter = Number(after.xp || 0);
  const delta = xpAfter - xpBefore;
  if (delta !== 0) {
    events.push({
      providerEventId: `poll:xp:${after.zealyUserId}:${xpBefore}:${xpAfter}`,
      eventType: delta > 0 ? 'XP_EARNED' : 'XP_DEDUCTED',
      source: 'POLL_DELTA',
      zealyUserId: after.zealyUserId,
      discordUserId: after.discordUserId || before.discord_user_id,
      xpDelta: delta,
      currentXp: xpAfter,
      rankBefore: before.rank,
      rankAfter: after.rank,
      metadata: { zealyName: after.zealyName, discordUsername: after.discordUsername },
      occurredAt,
    });
    const crossed = detectZealyMilestones(xpBefore, xpAfter, settings.rewardFeedMilestones || ZEALY_DEFAULT_MILESTONES, settings.rewardFeedMilestoneMode || 'HIGHEST_ONLY');
    for (const milestone of crossed) {
      events.push({
        providerEventId: `poll:milestone:${after.zealyUserId}:${milestone}`,
        eventType: 'MILESTONE_REACHED',
        source: 'POLL_DELTA',
        zealyUserId: after.zealyUserId,
        discordUserId: after.discordUserId || before.discord_user_id,
        currentXp: xpAfter,
        rankBefore: before.rank,
        rankAfter: after.rank,
        metadata: { milestone, zealyName: after.zealyName, discordUsername: after.discordUsername },
        occurredAt,
      });
    }
  }
  const rankBefore = Number(before.rank || 0);
  const rankAfter = Number(after.rank || 0);
  if (rankBefore && rankAfter && rankAfter < rankBefore) {
    events.push({
      providerEventId: `poll:rank:${after.zealyUserId}:${rankBefore}:${rankAfter}`,
      eventType: rankAfter <= 3 && rankBefore > 3 ? 'LEADERBOARD_TOP_3_ENTRY' : rankAfter <= 10 && rankBefore > 10 ? 'LEADERBOARD_TOP_10_ENTRY' : 'RANK_IMPROVEMENT',
      source: 'POLL_DELTA',
      zealyUserId: after.zealyUserId,
      discordUserId: after.discordUserId || before.discord_user_id,
      currentXp: xpAfter,
      rankBefore,
      rankAfter,
      metadata: { zealyName: after.zealyName, discordUsername: after.discordUsername },
      occurredAt,
    });
  }
  return events;
}

function detectZealyMilestones(beforeXp, afterXp, milestones = ZEALY_DEFAULT_MILESTONES, mode = 'HIGHEST_ONLY') {
  if (afterXp <= beforeXp) return [];
  const crossed = normalizeZealyMilestones(milestones).filter(value => value > beforeXp && value <= afterXp);
  if (mode === 'ALL') return crossed;
  return crossed.length ? [crossed[crossed.length - 1]] : [];
}

async function insertZealyEvent(event) {
  const result = await pool.query(
    `
    INSERT INTO discord_zealy_events
      (provider_event_id, event_type, source, zealy_user_id, discord_user_id, quest_id, quest_name, xp_delta, current_xp, rank_before, rank_after, reward_name, metadata, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
    ON CONFLICT DO NOTHING
    RETURNING *
    `,
    [
      event.providerEventId || null,
      event.eventType,
      event.source,
      event.zealyUserId || null,
      event.discordUserId || null,
      event.questId || null,
      event.questName || null,
      event.xpDelta ?? null,
      event.currentXp ?? null,
      event.rankBefore ?? null,
      event.rankAfter ?? null,
      event.rewardName || null,
      JSON.stringify(event.metadata || {}),
      event.occurredAt || new Date(),
    ]
  );
  return result.rows[0] || null;
}

async function buildZealyLeaderboardMessage(settings = null) {
  const resolved = settings || await getZealySettings();
  const members = (await pool.query(`SELECT * FROM discord_zealy_members WHERE rank IS NOT NULL ORDER BY rank ASC LIMIT $1`, [resolved.leaderboardLimit])).rows;
  const total = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_members`);
  const sprint = await fetchZealySprints({ onlyCurrent: true }).catch(() => []);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = members.map((row, index) => {
    const place = medals[index] || `${row.rank || index + 1}.`;
    const name = resolved.leaderboardShowDiscordNames ? zealyDisplayName(row) : (row.zealy_name || 'TTT Trader');
    const xp = resolved.leaderboardShowXp ? ` — ${Number(row.xp || 0).toLocaleString('en-GB')} XP` : '';
    return `${place} ${name}${xp}`;
  });
  const currentSprint = Array.isArray(sprint) ? sprint[0] : null;
  return [
    '🏆 **TTT MARKETS COMMUNITY LEADERBOARD**',
    '',
    lines.length ? lines.join('\n') : 'No Zealy leaderboard members cached yet.',
    '',
    resolved.leaderboardShowStats ? `Current Sprint: ${currentSprint?.name || 'None'}` : null,
    resolved.leaderboardShowStats ? `Community Members: ${Number(total.rows[0]?.count || 0).toLocaleString('en-GB')}` : null,
    `Last updated: <t:${Math.floor(Date.now() / 1000)}:R>`,
  ].filter(Boolean).join('\n');
}

async function publishZealyLeaderboard({ recreate = false } = {}) {
  const settings = await getZealySettings();
  if (!settings.leaderboardChannelId) throw createApiError('ZEALY_LEADERBOARD_CHANNEL_REQUIRED', 'Zealy leaderboard channel is not configured.', 400);
  const cachedMembers = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_members WHERE rank IS NOT NULL`);
  if (!Number(cachedMembers.rows[0]?.count || 0)) {
    const members = await fetchZealyLeaderboard({ limit: Math.max(25, settings.leaderboardLimit || 10) });
    if (members.length) {
      await upsertZealyMembers(members, { sprint: false, settings });
      await pool.query(
        `INSERT INTO discord_zealy_snapshots (snapshot_type, payload_hash, raw_payload, member_count) VALUES ('LEADERBOARD', $1, $2::jsonb, $3) ON CONFLICT DO NOTHING`,
        [safeJsonHash(members), JSON.stringify(members), members.length]
      );
    }
  }
  const readyMembers = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_members WHERE rank IS NOT NULL`);
  if (!Number(readyMembers.rows[0]?.count || 0)) {
    throw createApiError('ZEALY_LEADERBOARD_EMPTY', 'Zealy returned no leaderboard members to publish. Run Test connection and confirm the community subdomain/API key.', 502);
  }
  const channel = await fetchTextChannel(settings.leaderboardChannelId);
  const content = await buildZealyLeaderboardMessage(settings);
  let message = null;
  if (settings.leaderboardMessageId && !recreate) {
    try {
      message = await channel.messages.fetch(settings.leaderboardMessageId);
      message = await message.edit({ content, allowedMentions: { parse: [] } });
    } catch (error) {
      message = null;
    }
  }
  if (!message) {
    message = await channel.send({ content, allowedMentions: { parse: [] } });
  }
  await pool.query(`UPDATE discord_zealy_settings SET leaderboard_message_id = $1, last_sync_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = 1`, [message.id]);
  const memberCount = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_members WHERE rank IS NOT NULL`);
  await logActivity({ type: 'zealy', action: 'leaderboard_published', source: 'worker', metadata: { channelId: channel.id, messageId: message.id, memberCount: memberCount.rows[0]?.count || 0 } });
  return { messageId: message.id, channelId: channel.id, content, memberCount: memberCount.rows[0]?.count || 0 };
}

async function syncZealyLeaderboard({ publish = false } = {}) {
  if (zealyLeaderboardRunning) return { skipped: true, reason: 'already_running' };
  zealyLeaderboardRunning = true;
  try {
    const settings = await getZealySettings();
    const currentSprint = settings.leaderboardIncludeSprint ? (await fetchZealySprints({ onlyCurrent: true }).catch(() => []))[0] : null;
    const members = await fetchZealyLeaderboard({ limit: Math.max(25, settings.leaderboardLimit || 10) });
    const events = await upsertZealyMembers(members, { sprint: false, settings });
    if (currentSprint?.id) {
      const sprintMembers = await fetchZealyLeaderboard({ sprintId: currentSprint.id, limit: Math.max(25, settings.leaderboardLimit || 10) }).catch(() => []);
      await upsertZealyMembers(sprintMembers, { sprint: true, settings });
    }
    await pool.query(
      `INSERT INTO discord_zealy_snapshots (snapshot_type, payload_hash, raw_payload, member_count) VALUES ('LEADERBOARD', $1, $2::jsonb, $3) ON CONFLICT DO NOTHING`,
      [safeJsonHash(members), JSON.stringify(members), members.length]
    );
    let inserted = 0;
    for (const event of events) {
      const saved = await insertZealyEvent(event);
      if (saved) inserted += 1;
    }
    await pool.query(`UPDATE discord_zealy_settings SET last_sync_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = 1`);
    const publishResult = publish || settings.leaderboardEnabled ? await publishZealyLeaderboard() : null;
    if (settings.rewardFeedEnabled) await processPendingZealyEvents();
    return { synced: true, members: members.length, eventsDetected: inserted, currentSprint, publishResult };
  } catch (error) {
    await pool.query(`UPDATE discord_zealy_settings SET last_error = $1, updated_at = NOW() WHERE id = 1`, [sanitizePublicErrorMessage(error)]);
    throw error;
  } finally {
    zealyLeaderboardRunning = false;
  }
}

async function zealyTemplateForEvent(eventType) {
  const result = await pool.query(`SELECT * FROM discord_zealy_templates WHERE event_type = $1 AND enabled = true ORDER BY is_seeded DESC, id ASC LIMIT 1`, [eventType]);
  if (result.rowCount) return result.rows[0];
  const fallback = await pool.query(`SELECT * FROM discord_zealy_templates WHERE event_type = 'XP_EARNED' AND enabled = true ORDER BY id ASC LIMIT 1`);
  return fallback.rows[0] || { title_template: 'Zealy update', body_template: '{{user_display}} earned {{formatted_xp_delta}} XP', colour: '#f35023', reactions: [] };
}

async function sendZealyEvent(eventRow, { channelId = null } = {}) {
  const settings = await getZealySettings();
  const toggles = settings.rewardFeedEventToggles || {};
  if (toggles[eventRow.event_type] === false) {
    await pool.query(`UPDATE discord_zealy_events SET status = 'SKIPPED', processed_at = NOW(), updated_at = NOW() WHERE id = $1`, [eventRow.id]);
    return { skipped: true };
  }
  const destinationChannelId = channelId || settings.rewardFeedChannelId;
  if (!destinationChannelId) throw createApiError('ZEALY_REWARD_CHANNEL_REQUIRED', 'Zealy reward feed channel is not configured.', 400);
  const channel = await fetchTextChannel(destinationChannelId);
  const template = await zealyTemplateForEvent(eventRow.event_type);
  const values = zealyEventValues(eventRow);
  const embed = new EmbedBuilder()
    .setTitle(renderZealyTemplateString(template.title_template, values).slice(0, 256))
    .setDescription(renderZealyTemplateString(template.body_template, values).slice(0, 4096))
    .setColor(parseHexColor(template.colour || '#f35023'))
    .setTimestamp(new Date(eventRow.occurred_at || Date.now()));
  if (template.footer_text) embed.setFooter({ text: renderZealyTemplateString(template.footer_text, values).slice(0, 2048) });
  if (template.thumbnail_url) embed.setThumbnail(template.thumbnail_url);
  if (template.image_url) embed.setImage(template.image_url);
  const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  await addReactions(message, sanitizeReactions(template.reactions || []));
  await pool.query(`UPDATE discord_zealy_events SET status = 'POSTED', processed_at = NOW(), discord_channel_id = $2, discord_message_id = $3, last_error = NULL, updated_at = NOW() WHERE id = $1`, [eventRow.id, channel.id, message.id]);
  await logActivity({ type: 'zealy', action: 'reward_notification_posted', source: 'worker', entityType: 'discord_zealy_event', entityId: String(eventRow.id), metadata: { eventType: eventRow.event_type, channelId: channel.id, messageId: message.id } });
  return { sent: true, messageId: message.id, channelId: channel.id };
}

async function processPendingZealyEvents() {
  const result = await pool.query(`SELECT * FROM discord_zealy_events WHERE status IN ('PENDING','FAILED') ORDER BY occurred_at ASC LIMIT 25`);
  let posted = 0;
  let failed = 0;
  for (const row of result.rows) {
    try {
      const sent = await sendZealyEvent(row);
      if (sent.sent) posted += 1;
    } catch (error) {
      failed += 1;
      await pool.query(`UPDATE discord_zealy_events SET status = 'FAILED', last_error = $2, updated_at = NOW() WHERE id = $1`, [row.id, sanitizePublicErrorMessage(error)]);
    }
  }
  return { processed: result.rows.length, posted, failed };
}

function parseHexColor(value) {
  const hex = String(value || '').replace('#', '');
  return /^[a-f0-9]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : BRAND_COLOR;
}

async function getZealySecretStatus() {
  const result = await pool.query(`SELECT * FROM discord_secret_settings WHERE key = ANY($1::text[])`, [['ZEALY_API_KEY', 'ZEALY_COMMUNITY_SUBDOMAIN', 'ZEALY_WEBHOOK_SECRET', 'ZEALY_API_BASE_URL']]);
  const existing = new Map(result.rows.map(row => [row.key, serializeSecret(row)]));
  return Object.fromEntries(['ZEALY_API_KEY', 'ZEALY_COMMUNITY_SUBDOMAIN', 'ZEALY_WEBHOOK_SECRET', 'ZEALY_API_BASE_URL'].map(key => [key, existing.get(key) || {
    key,
    label: getSecretDefinition(key).label,
    configured: Boolean(process.env[key]),
    lastFour: process.env[key] ? String(process.env[key]).slice(-4) : null,
    requiresRestart: false,
    updatedAt: null,
    updatedBy: process.env[key] ? 'environment' : null,
  }]));
}

async function getZealyOverview() {
  const [settings, secrets, members, eventsToday, notificationsToday, failed, recentEvents, templates] = await Promise.all([
    getZealySettings(),
    getZealySecretStatus(),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_members`),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_events WHERE occurred_at >= CURRENT_DATE`),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_events WHERE status = 'POSTED' AND processed_at >= CURRENT_DATE`),
    pool.query(`SELECT COUNT(*)::int AS count FROM discord_zealy_events WHERE status = 'FAILED'`),
    pool.query(`SELECT * FROM discord_zealy_events ORDER BY occurred_at DESC LIMIT 10`),
    pool.query(`SELECT * FROM discord_zealy_templates ORDER BY event_type ASC, id ASC`),
  ]);
  const currentSprint = await fetchZealySprints({ onlyCurrent: true }).catch(() => []);
  const connected = Boolean(secrets.ZEALY_API_KEY?.configured && (settings.communitySubdomain || secrets.ZEALY_COMMUNITY_SUBDOMAIN?.configured));
  return {
    connected,
    settings,
    secrets,
    communitySubdomain: settings.communitySubdomain,
    apiStatus: connected ? 'Configured' : 'Not configured',
    webhookStatus: secrets.ZEALY_WEBHOOK_SECRET?.configured ? 'Secret configured' : 'No secret configured',
    lastSuccessfulSync: settings.lastSyncAt,
    lastWebhookReceived: settings.lastWebhookAt,
    membersCached: members.rows[0]?.count || 0,
    currentSprint: Array.isArray(currentSprint) ? currentSprint[0] || null : null,
    eventsDetectedToday: eventsToday.rows[0]?.count || 0,
    notificationsPostedToday: notificationsToday.rows[0]?.count || 0,
    failedNotifications: failed.rows[0]?.count || 0,
    leaderboardMessageStatus: settings.leaderboardMessageId ? 'Stored' : 'Not published',
    nextScheduledRefresh: settings.leaderboardEnabled ? new Date(Date.now() + settings.leaderboardRefreshMinutes * 60_000).toISOString() : null,
    lastError: settings.lastError,
    recentEvents: recentEvents.rows.map(serializeZealyEvent),
    templates: templates.rows.map(serializeZealyTemplate),
    capabilityMatrix: zealyCapabilityMatrix([]),
  };
}

function normalizeZealyWebhookEvent(payload = {}) {
  const eventType = String(payload.event || payload.eventType || payload.type || payload.name || 'UNKNOWN').toUpperCase();
  const data = payload.data || payload.payload || payload;
  const user = data.user || data.member || data.account || {};
  const quest = data.quest || data.claimedQuest || data.review?.quest || {};
  const reward = data.reward || data.shopReward || data.redemption || {};
  const xpDelta = Number(data.xpDelta ?? data.xp_delta ?? data.xp ?? quest.xp ?? reward.xp ?? 0);
  const zealyUserId = String(user.id || data.userId || data.zealyUserId || '').trim() || null;
  const discordUserId = user.discord?.id || user.discordId || data.discordId || null;
  const mappedType = eventType.includes('DAILY') ? 'DAILY_QUEST_COMPLETED'
    : eventType.includes('WEEKLY') ? 'WEEKLY_QUEST_COMPLETED'
      : eventType.includes('QUEST') ? 'QUEST_COMPLETED'
        : eventType.includes('REWARD') || eventType.includes('SHOP') || eventType.includes('REDEMPTION') ? 'SHOP_REWARD_REDEMPTION'
          : eventType.includes('USER') || eventType.includes('MEMBER') ? 'NEW_MEMBER_JOINED'
            : eventType.includes('XP') && xpDelta < 0 ? 'XP_DEDUCTED'
              : eventType.includes('XP') ? 'XP_EARNED'
                : eventType;
  return {
    providerEventId: payload.id || payload.eventId || payload.event_id || payload.deliveryId || null,
    eventType: mappedType,
    source: 'WEBHOOK',
    zealyUserId,
    discordUserId,
    questId: quest.id || data.questId || null,
    questName: quest.name || data.questName || null,
    xpDelta,
    currentXp: data.currentXp || user.xp || null,
    rewardName: reward.name || data.rewardName || null,
    metadata: {
      originalEventType: eventType,
      zealyName: user.name || data.zealyName || null,
      discordUsername: user.discord?.handle || user.discordHandle || null,
      webhookConfirmed: true,
    },
    occurredAt: data.createdAt || payload.createdAt || payload.timestamp || new Date(),
  };
}

function verifyZealyWebhookSecret(payload = {}, configuredSecret = null) {
  if (!configuredSecret) return true;
  const provided = payload.secret || payload.webhookSecret || payload.webhook_secret;
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(configuredSecret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function zealySyncDue(lastAt, minutes) {
  if (!lastAt) return true;
  const last = typeof lastAt === 'number' ? lastAt : new Date(lastAt).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= Math.max(5, Number(minutes || 10)) * 60_000;
}

async function handleZealyWebhook(payload = {}) {
  const secret = await getStoredSecretValue('ZEALY_WEBHOOK_SECRET');
  const signatureValid = verifyZealyWebhookSecret(payload, secret);
  const payloadHash = safeJsonHash(payload);
  const deliveryId = payload.deliveryId || payload.delivery_id || payload.id || payload.eventId || payload.event_id || null;
  const eventType = payload.event || payload.eventType || payload.type || 'UNKNOWN';
  const receipt = await pool.query(
    `
    INSERT INTO discord_zealy_webhook_receipts
      (delivery_id, event_type, signature_valid, payload_hash, raw_payload, status)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6)
    ON CONFLICT DO NOTHING
    RETURNING *
    `,
    [deliveryId, eventType, signatureValid, payloadHash, JSON.stringify(payload), signatureValid ? 'RECEIVED' : 'REJECTED']
  );
  await pool.query(`UPDATE discord_zealy_settings SET last_webhook_at = NOW(), updated_at = NOW() WHERE id = 1`);
  if (!signatureValid) {
    await logActivity({ type: 'zealy', action: 'webhook_rejected', source: 'zealy_webhook', metadata: { eventType, deliveryId } });
    throw createApiError('ZEALY_WEBHOOK_INVALID_SECRET', 'Invalid Zealy webhook secret.', 401);
  }
  if (!receipt.rowCount) return { duplicate: true };
  const normalized = normalizeZealyWebhookEvent(payload);
  const saved = await insertZealyEvent(normalized);
  await pool.query(`UPDATE discord_zealy_webhook_receipts SET processed_at = NOW(), status = $2 WHERE id = $1`, [receipt.rows[0].id, saved ? 'PROCESSED' : 'DUPLICATE']);
  await logActivity({ type: 'zealy', action: 'webhook_received', source: 'zealy_webhook', metadata: { eventType: normalized.eventType, deliveryId, saved: Boolean(saved) } });
  if (saved) processPendingZealyEvents().catch(error => console.log(`Zealy webhook event post failed: ${error.message}`));
  return { received: true, eventCreated: Boolean(saved), event: saved ? serializeZealyEvent(saved) : null };
}

function startZealySchedulers() {
  if (zealyLeaderboardIntervalHandle) clearInterval(zealyLeaderboardIntervalHandle);
  if (zealyRewardIntervalHandle) clearInterval(zealyRewardIntervalHandle);
  zealyLeaderboardIntervalHandle = setInterval(async () => {
    const settings = await getZealySettings().catch(() => ZEALY_DEFAULT_SETTINGS);
    if (settings.enabled && settings.leaderboardEnabled && zealySyncDue(lastZealyLeaderboardPublishAt, settings.leaderboardRefreshMinutes)) {
      try {
        if (zealySyncDue(settings.lastSyncAt, settings.leaderboardRefreshMinutes)) await syncZealyLeaderboard({ publish: true });
        else await publishZealyLeaderboard();
        lastZealyLeaderboardPublishAt = Date.now();
      } catch (error) {
        console.log(`Zealy leaderboard sync failed: ${error.message}`);
      }
    }
  }, 60 * 1000);
  zealyRewardIntervalHandle = setInterval(async () => {
    if (zealyRewardRunning) return;
    zealyRewardRunning = true;
    try {
      const settings = await getZealySettings();
      if (settings.enabled && settings.rewardFeedEnabled && zealySyncDue(lastZealyRewardPollAt, settings.rewardFeedPollMinutes)) {
        await syncZealyLeaderboard({ publish: false }).catch(error => console.log(`Zealy reward delta sync failed: ${error.message}`));
        await processPendingZealyEvents();
        lastZealyRewardPollAt = Date.now();
      }
    } finally {
      zealyRewardRunning = false;
    }
  }, 60 * 1000);
}

async function pollDuePayoutFeedItems() {
  if (payoutFeedPollRunning) return { skipped: true, reason: 'already_running' };
  payoutFeedPollRunning = true;
  try {
    const settings = await getPayoutFeedSettings();
    if (!settings.enabled || settings.mode !== 'SIMULATION' || !settings.simulationEnabled) return { skipped: true, reason: 'disabled' };
    await ensurePayoutWeek();
    await pool.query(
      `
      UPDATE discord_payout_feed_items
      SET status = 'SKIPPED', last_error = 'Skipped stale scheduled payout', updated_at = NOW()
      WHERE status = 'SCHEDULED'
        AND source_type = 'SIMULATION'
        AND is_simulated = true
        AND scheduled_for < NOW() - ($1 || ' minutes')::interval
      `,
      [PAYOUT_STALE_GRACE_MINUTES]
    );
    let processed = 0;
    while (processed < 5) {
      const result = await pool.query(
        `
        UPDATE discord_payout_feed_items
        SET status = 'PROCESSING', attempt_count = attempt_count + 1, updated_at = NOW()
        WHERE id = (
          SELECT id
          FROM discord_payout_feed_items
          WHERE status = 'SCHEDULED'
            AND source_type = 'SIMULATION'
            AND is_simulated = true
            AND scheduled_for <= NOW()
          ORDER BY scheduled_for ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
        `
      );
      if (!result.rowCount) break;
      const item = result.rows[0];
      try {
        const sent = await sendPayoutFeedItem(item);
        await pool.query(
          `
          UPDATE discord_payout_feed_items
          SET status = 'POSTED', discord_message_id = $2, posted_at = NOW(), last_error = NULL, updated_at = NOW()
          WHERE id = $1
          `,
          [item.id, sent.messageId]
        );
        await refreshPayoutWeekCounts(item.week_id);
        await logActivity({ type: 'payout_feed', action: 'item_posted', source: 'bot', entityType: 'discord_payout_feed_item', entityId: String(item.id), metadata: sent });
      } catch (error) {
        const retry = Number(item.attempt_count || 0) < 3;
        await pool.query(
          `
          UPDATE discord_payout_feed_items
          SET status = $2,
              scheduled_for = CASE WHEN $2 = 'SCHEDULED' THEN NOW() + INTERVAL '10 minutes' ELSE scheduled_for END,
              last_error = $3,
              updated_at = NOW()
          WHERE id = $1
          `,
          [item.id, retry ? 'SCHEDULED' : 'FAILED', sanitizePublicErrorMessage(error)]
        );
        await refreshPayoutWeekCounts(item.week_id);
        await logActivity({ type: 'payout_feed', action: retry ? 'item_retry_scheduled' : 'item_failed', source: 'bot', entityType: 'discord_payout_feed_item', entityId: String(item.id), errorMessage: sanitizePublicErrorMessage(error) });
      }
      processed += 1;
    }
    return { processed };
  } finally {
    payoutFeedPollRunning = false;
  }
}

async function startPayoutFeedScheduler() {
  if (payoutFeedIntervalHandle) clearInterval(payoutFeedIntervalHandle);
  await ensurePayoutWeek().catch(error => console.log(`Payout feed week generation skipped: ${error.message}`));
  payoutFeedIntervalHandle = setInterval(() => {
    pollDuePayoutFeedItems().catch(error => console.log(`Payout feed poll failed: ${error.message}`));
  }, Math.max(15_000, PAYOUT_FEED_POLL_MS));
}

async function getPayoutFeedOverview() {
  const settings = await getPayoutFeedSettings();
  const { weekStart } = localWeekRange(new Date(), settings.timezone);
  const [currentWeek, totals, nextItem, recent] = await Promise.all([
    pool.query(`SELECT * FROM discord_payout_feed_weeks WHERE mode = $1 AND week_start = $2 LIMIT 1`, [settings.mode === 'LIVE' ? 'LIVE' : 'SIMULATION', weekStart]),
    pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled,
        COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
        COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
        COUNT(*) FILTER (WHERE is_simulated = true)::int AS simulated_total,
        COUNT(*) FILTER (WHERE is_simulated = false)::int AS live_total
      FROM discord_payout_feed_items
      `
    ),
    pool.query(`SELECT i.*, t.body_template FROM discord_payout_feed_items i LEFT JOIN discord_payout_feed_templates t ON t.id = i.template_id WHERE i.status = 'SCHEDULED' ORDER BY i.scheduled_for ASC LIMIT 1`),
    pool.query(`SELECT i.*, t.body_template FROM discord_payout_feed_items i LEFT JOIN discord_payout_feed_templates t ON t.id = i.template_id ORDER BY i.created_at DESC LIMIT 10`),
  ]);
  return {
    settings,
    currentWeek: currentWeek.rows[0] ? serializePayoutWeek(currentWeek.rows[0]) : null,
    scheduledCount: totals.rows[0]?.scheduled || 0,
    postedCount: totals.rows[0]?.posted || 0,
    failedCount: totals.rows[0]?.failed || 0,
    simulatedTotal: totals.rows[0]?.simulated_total || 0,
    liveTotal: totals.rows[0]?.live_total || 0,
    nextScheduledItem: nextItem.rows[0] ? serializePayoutItem(nextItem.rows[0]) : null,
    recentItems: recent.rows.map(serializePayoutItem),
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
      SELECT user_id, created_at, status, unsubscribed_at, username, display_name, avatar_url
      FROM subscribers
      WHERE user_id ILIKE $1
         OR username ILIKE $1
         OR display_name ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `
    : `
      SELECT user_id, created_at, status, unsubscribed_at, username, display_name, avatar_url
      FROM subscribers
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `;

  const countQuery = search
    ? `SELECT COUNT(*)::int AS count FROM subscribers WHERE user_id ILIKE $1 OR username ILIKE $1 OR display_name ILIKE $1`
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
    `SELECT user_id, created_at, status, unsubscribed_at, username, display_name, avatar_url FROM subscribers WHERE user_id = $1`,
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
  const cached = includeUser && client.isReady() ? cachedDiscordIdentity(row.user_id) : {};
  const username = cached.username || row.username || null;
  const displayName = cached.displayName || row.display_name || username || null;
  const avatarUrl = cached.avatarUrl || row.avatar_url || null;
  const dmStats = await getSubscriberDmStats(row.user_id);

  return {
    discordUserId: row.user_id,
    username,
    displayName,
    avatar: avatarUrl,
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
  const hasExplicitComponents = Object.prototype.hasOwnProperty.call(payload, 'components');
  const components = hasExplicitComponents
    ? (Array.isArray(payload.components) ? payload.components : [])
    : buildButtonRows(payload.buttons?.length ? payload.buttons : [{ label: 'Visit Website', url: WEBSITE_URL }]);

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
  const permissions = client.user ? channel.permissionsFor(client.user) : null;
  if (permissions && !permissions.has(PermissionFlagsBits.EmbedLinks)) {
    const error = new Error('Bot cannot publish embeds in this channel. Enable Embed Links for the bot role.');
    error.status = 403;
    error.code = 'MISSING_EMBED_LINKS_PERMISSION';
    throw error;
  }
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

function managedPublishDiagnostics({ managedPost, payload, targetChannelId, targetMessageId, description, buttons }) {
  const contentBlocks = sanitizeManagedBlocks(payload.contentBlocks || []);
  return {
    managedPostId: managedPost.id,
    internalName: payload.internalName || managedPost.internal_name || null,
    targetChannelId,
    targetMessageId: targetMessageId || null,
    savedChannelId: managedPost.channel_id || null,
    savedMessageId: managedPost.message_id || null,
    hasTitle: Boolean(payload.title || managedPost.internal_name),
    descriptionLength: String(description || '').length,
    fieldCount: Array.isArray(payload.fields) ? payload.fields.length : 0,
    bottomButtonCount: buttons.length,
    blockCount: contentBlocks.length,
    blockLinkCount: contentBlocks.reduce((sum, block) => sum + (block.buttons?.length || 0), 0),
    reactionCount: sanitizeReactions(payload.reactions || DEFAULT_MANAGED_REACTIONS).length,
  };
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
  if (postedCount > 0) await setAppState('lastYoutubePostAt', new Date().toISOString());
  return { postedCount, failedCount, channelIds, videoId: video.id || null };
}

async function getPostedYoutubeVideoIds() {
  const state = await getJsonAppState('postedYoutubeVideoIds', []);
  return new Set(Array.isArray(state) ? state.map(String).filter(Boolean) : []);
}

async function rememberPostedYoutubeVideoId(videoId) {
  if (!videoId) return;
  const ids = await getPostedYoutubeVideoIds();
  ids.add(String(videoId));
  await setJsonAppState('postedYoutubeVideoIds', Array.from(ids).slice(-250));
}

async function hasYoutubeVideoBeenPosted(videoId) {
  if (!videoId) return false;
  const ids = await getPostedYoutubeVideoIds();
  if (ids.has(String(videoId))) return true;
  const result = await pool.query(
    `
    SELECT 1
    FROM discord_activity_logs
    WHERE type = 'youtube'
      AND action = 'posted'
      AND entity_id = $1
    LIMIT 1
    `,
    [String(videoId)]
  );
  return result.rowCount > 0;
}

async function checkYoutubeFeed() {
  if (youtubeCheckRunning) {
    console.log('YouTube check skipped: previous check still running.');
    return;
  }
  const lockClient = await acquireAdvisoryLock(YOUTUBE_ADVISORY_LOCK_KEY).catch(() => null);
  if (!lockClient) {
    console.log('YouTube check skipped: another worker holds the posting lock.');
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

    const video = unseenItems.find(item => settings.autoPostShorts !== false || !looksLikeShort(item));
    if (video) {
      if (await hasYoutubeVideoBeenPosted(video.videoId)) {
        await rememberPostedYoutubeVideoId(video.videoId);
        await setAppState('lastVideoId', newestVideoId);
        await logActivity({
          type: 'youtube',
          action: 'duplicate_skipped',
          source: 'bot',
          entityType: 'youtube_video',
          entityId: video.videoId,
          metadata: { title: video.title, link: video.link },
        });
        console.log(`Skipped duplicate YouTube video: ${video.videoId}.`);
        return;
      }
      const postResult = await postYoutubeVideo({
        id: video.videoId,
        title: video.title,
        link: video.link,
        thumbnail: getYoutubeThumbnail(video.videoId),
      });
      if (postResult.postedCount > 0) {
        await rememberPostedYoutubeVideoId(video.videoId);
        await setAppState('lastVideoId', newestVideoId);
        console.log(`Posted newest YouTube video: ${video.videoId}. Skipped ${Math.max(0, unseenItems.length - 1)} older unseen item(s).`);
      } else {
        console.log(`YouTube video ${video.videoId} was not marked seen because no Discord channel post succeeded.`);
      }
    } else {
      await setAppState('lastVideoId', newestVideoId);
      console.log(`No eligible YouTube video to post. Marked newest seen item: ${newestVideoId}.`);
    }
  } catch (error) {
    console.error('YouTube check failed:', error.message);
  } finally {
    youtubeCheckRunning = false;
    await releaseAdvisoryLock(lockClient, YOUTUBE_ADVISORY_LOCK_KEY);
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
    const added = await addSubscriber(member.id, member);
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

  await startNewsSchedulers().catch(error => {
    console.log(`News scheduler startup failed: ${error.message}`);
  });

  await startPayoutFeedScheduler().catch(error => {
    console.log(`Payout feed scheduler startup failed: ${error.message}`);
  });
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
  const status = error.status || error.httpStatus || (error.code ? 400 : 500);
  res.status(status).json({
    ok: false,
    error: {
      code: error.code || (status < 500 ? 'BAD_REQUEST' : 'SERVER_ERROR'),
      message: sanitizePublicErrorMessage(error),
      details: error.details || undefined,
    },
  });
}

function sanitizePublicErrorMessage(error) {
  const message = String(error?.message || '').trim();
  if (!message) return 'Server error';
  if (/token|secret|authorization|bearer|password/i.test(message)) return 'Server error';
  return message.slice(0, 500);
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
  const splitList = (value) => Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,]+/).map(row => row.trim()).filter(Boolean);
  const channelIds = Array.isArray(body.channelIds)
    ? body.channelIds.map(id => normalizeDiscordId(id)).filter(Boolean)
    : [];
  const mappedChannelKeys = splitList(body.mappedChannels || body.mappedChannelGroups || body.mappedChannelKeys)
    .filter(key => CHANNEL_MAPPING_KEYS.includes(key));
  const selectedSubscriberIds = splitList(body.selectedSubscriberIds)
    .map(id => normalizeDiscordId(id))
    .filter(Boolean);
  const payload = {
    title: String(body.title || '').trim(),
    message: String(body.message || body.description || '').trim(),
    imageUrl: body.imageUrl || null,
    thumbnail: body.thumbnail || null,
    channelIds,
    mappedChannelKeys,
    sendDm: toBoolean(body.sendToSubscribersByDm ?? body.sendSubscriberDms ?? body.sendDm, false),
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

function serializeDmCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    announcementId: row.announcement_id,
    name: row.name,
    status: row.status,
    totalCount: Number(row.total_count || 0),
    successCount: Number(row.success_count || 0),
    failureCount: Number(row.failure_count || 0),
    pendingCount: Math.max(0, Number(row.total_count || 0) - Number(row.success_count || 0) - Number(row.failure_count || 0)),
    lastProcessedRecipient: row.last_processed_recipient || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

function serializeDmDelivery(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    discordUserId: row.discord_user_id,
    status: row.status,
    errorMessage: row.error_message || null,
    username: row.username || null,
    displayName: row.display_name || null,
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
  };
}

function channelStatsFromAnnouncementLogs(rows) {
  let postedCount = 0;
  let failedCount = 0;
  const posts = [];
  const timeline = [];

  for (const row of rows) {
    const metadata = parseActivityMetadata(row.metadata);
    const channelResult = metadata.channelResult || metadata.result?.channelResult || {};
    const summary = metadata.summary || {};
    const postRows = Array.isArray(channelResult.posts)
      ? channelResult.posts
      : Array.isArray(metadata.posts)
        ? metadata.posts
        : [];
    const rowPosted = Number(channelResult.postedCount ?? summary.postedCount ?? postRows.length ?? 0) || 0;
    const rowFailed = Number(channelResult.failedCount ?? summary.failedCount ?? 0) || 0;

    postedCount += rowPosted;
    failedCount += rowFailed;
    for (const post of postRows) {
      posts.push({
        channelId: post.channelId || post.channel_id || null,
        messageId: post.messageId || post.message_id || null,
        status: 'sent',
        createdAt: row.created_at,
      });
    }

    if (Array.isArray(metadata.timeline)) {
      for (const step of metadata.timeline) {
        timeline.push({
          label: step.label || step.step || row.action,
          status: step.status || (row.error_message ? 'failed' : 'completed'),
          detail: step.detail || step.message || row.error_message || null,
          at: row.created_at,
        });
      }
    } else {
      timeline.push({
        label: row.action === 'send_failed' ? 'Announcement failed' : 'Announcement sent',
        status: row.error_message ? 'failed' : 'completed',
        detail: row.error_message || `${rowPosted} channel post(s), ${rowFailed} failure(s)`,
        at: row.created_at,
      });
    }
  }

  return { postedCount, failedCount, posts, timeline };
}

async function getAnnouncementStats(id, { deliveryLimit = 50 } = {}) {
  const [campaignResult, deliveriesResult, activityResult] = await Promise.all([
    pool.query(
      `
      SELECT *
      FROM discord_dm_campaigns
      WHERE announcement_id = $1
      ORDER BY created_at DESC
      `,
      [id]
    ),
    pool.query(
      `
      SELECT d.*, s.username, s.display_name, s.avatar_url
      FROM discord_dm_deliveries d
      JOIN discord_dm_campaigns c ON c.id = d.campaign_id
      LEFT JOIN subscribers s ON s.user_id = d.discord_user_id
      WHERE c.announcement_id = $1
      ORDER BY d.created_at DESC
      LIMIT $2
      `,
      [id, deliveryLimit]
    ),
    pool.query(
      `
      SELECT *
      FROM discord_activity_logs
      WHERE entity_type = 'announcement'
        AND entity_id = $1
        AND type = 'announcement'
      ORDER BY created_at ASC
      `,
      [String(id)]
    ),
  ]);

  const campaigns = campaignResult.rows.map(serializeDmCampaign).filter(Boolean);
  const deliveries = deliveriesResult.rows.map(serializeDmDelivery).filter(Boolean);
  const channelStats = channelStatsFromAnnouncementLogs(activityResult.rows);
  const dmTotal = campaigns.reduce((sum, campaign) => sum + campaign.totalCount, 0);
  const dmSuccess = campaigns.reduce((sum, campaign) => sum + campaign.successCount, 0);
  const dmFailure = campaigns.reduce((sum, campaign) => sum + campaign.failureCount, 0);
  const dmPending = Math.max(0, dmTotal - dmSuccess - dmFailure);

  const campaignTimeline = campaigns.map((campaign) => ({
    label: `DM campaign ${campaign.id}`,
    status: campaign.status,
    detail: `${campaign.successCount} sent, ${campaign.failureCount} failed, ${campaign.pendingCount} pending`,
    at: campaign.completedAt || campaign.updatedAt || campaign.createdAt,
  }));

  return {
    channel: {
      selectedCount: 0,
      postedCount: channelStats.postedCount,
      failedCount: channelStats.failedCount,
      posts: channelStats.posts,
    },
    dm: {
      campaignCount: campaigns.length,
      totalCount: dmTotal,
      successCount: dmSuccess,
      failureCount: dmFailure,
      pendingCount: dmPending,
      campaigns,
      deliveries,
    },
    timeline: [...channelStats.timeline, ...campaignTimeline]
      .filter(Boolean)
      .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()),
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
  const timeline = [
    { label: 'Announcement loaded', status: 'completed', detail: `Announcement ${id}` },
    { label: 'Destinations resolved', status: 'completed', detail: `${channelIds.length} channel(s), ${payload.sendDm ? 'subscriber DMs enabled' : 'subscriber DMs disabled'}` },
  ];

  try {
    let campaign = null;
    if (payload.sendDm) {
      const recipientIds = payload.selectedSubscriberIds?.length
        ? payload.selectedSubscriberIds
        : await getSubscriberIds();
      timeline.push({ label: 'Subscriber recipients resolved', status: 'completed', detail: `${recipientIds.length} subscriber(s)` });
      campaign = await createDmCampaign({
        name: `Announcement ${id}`,
        announcementId: id,
        recipientIds,
        payload,
        actor: req ? getActor(req) : null,
      });
      startDmCampaign(campaign.id);
      timeline.push({ label: 'Subscriber DM campaign queued', status: 'queued', detail: `Campaign ${campaign.id} queued for ${campaign.total_count} subscriber(s)` });
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
    timeline.push({
      label: 'Channel posting complete',
      status: result.channelResult.failedCount ? (result.channelResult.postedCount ? 'partial' : 'failed') : 'completed',
      detail: `${result.channelResult.postedCount} posted, ${result.channelResult.failedCount} failed`,
      posts: result.channelResult.posts,
    });
    result.timeline = timeline;
    result.summary = {
      channelCount: channelIds.length,
      postedCount: result.channelResult.postedCount,
      failedCount: result.channelResult.failedCount,
      dmCampaignId: campaign?.id || null,
      dmRecipientCount: campaign?.total_count || 0,
    };

    await pool.query(
      `
      UPDATE discord_announcements
      SET status = $2, sent_at = NOW(), updated_at = NOW(), last_error = $3
      WHERE id = $1
      `,
      [
        id,
        result.channelResult.failedCount ? (result.channelResult.postedCount || campaign ? 'PARTIAL' : 'FAILED') : (campaign ? 'QUEUED' : 'COMPLETED'),
        result.channelResult.failedCount ? `${result.channelResult.failedCount} channel post(s) failed` : null,
      ]
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
    timeline.push({ label: 'Announcement failed', status: 'failed', detail: error.message });
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
    error.details = { timeline };
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
  const timeline = [
    { label: 'Announcement saved', status: 'completed', detail: `Announcement ${id} saved as ${status}` },
  ];
  if (payload.sendImmediately && !payload.saveAsDraft) {
    sendResult = await sendAnnouncementById(id, req);
    timeline.push(...(sendResult.timeline || []));
  }

  return {
    announcement: await getAnnouncement(id),
    sendResult,
    timeline,
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
    buttons: sanitizeButtons(body.buttons || body.payload?.buttons || [], { dropInvalid: true }),
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
      const added = await addSubscriber(userId, interaction.user);

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
    const added = await addSubscriber(user.id, user);

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

  app.post('/api/webhooks/zealy', asyncRoute(async (req, res) => {
    const result = await handleZealyWebhook(req.body || {});
    res.status(202).json({ ok: true, received: true, duplicate: Boolean(result.duplicate) });
  }));

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
    scheduleSubscriberIdentityHydration(100);
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
    const campaignStats = await pool.query(
      `
      SELECT announcement_id,
             COUNT(*)::int AS campaign_count,
             COALESCE(SUM(total_count), 0)::int AS dm_total,
             COALESCE(SUM(success_count), 0)::int AS dm_success,
             COALESCE(SUM(failure_count), 0)::int AS dm_failure
      FROM discord_dm_campaigns
      WHERE announcement_id = ANY($1::bigint[])
      GROUP BY announcement_id
      `,
      [result.rows.map(row => row.id)]
    );
    const campaignStatsByAnnouncement = new Map(campaignStats.rows.map(row => [String(row.announcement_id), row]));
    const announcements = result.rows.map(row => {
      const stats = campaignStatsByAnnouncement.get(String(row.id)) || {};
      const channelIds = Array.isArray(row.payload?.channelIds) ? row.payload.channelIds : [];
      const dmTotal = Number(stats.dm_total || 0);
      const dmSuccess = Number(stats.dm_success || 0);
      const dmFailure = Number(stats.dm_failure || 0);
      return {
        id: row.id,
        title: row.title,
        message: row.message,
        imageUrl: row.image_url,
        payload: row.payload,
        status: row.status,
        lastError: row.last_error,
        stats: {
          channelSelectedCount: channelIds.length,
          dmCampaignCount: Number(stats.campaign_count || 0),
          dmTotal,
          dmSuccess,
          dmFailure,
          dmPending: Math.max(0, dmTotal - dmSuccess - dmFailure),
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sentAt: row.sent_at,
      };
    });
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
    const stats = await getAnnouncementStats(req.params.id, {
      deliveryLimit: parsePositiveInt(req.query.deliveryLimit, 50, 500),
    });
    stats.channel.selectedCount = Array.isArray(announcement.channelIds) ? announcement.channelIds.length : 0;
    announcement.stats = stats;
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

  router.get('/managed-posts/:id/publish-diagnostics', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('MANAGED_POST_NOT_FOUND', 'Managed post not found', 404);
    const managedPost = result.rows[0];
    const payload = managedPost.payload || {};
    const targetChannelId = payload.channelId || managedPost.channel_id;
    const targetMessageId = targetChannelId === managedPost.channel_id ? managedPost.message_id : null;
    const description = managedDescriptionFromPayload(payload);
    const buttons = managedButtonsFromPayload(payload);
    const diagnostics = managedPublishDiagnostics({ managedPost, payload, targetChannelId, targetMessageId, description, buttons });

    try {
      const channel = await fetchTextChannel(targetChannelId);
      diagnostics.channel = {
        id: channel.id,
        name: channel.name || null,
        type: channel.type,
        canView: Boolean(channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ViewChannel)),
        canSend: Boolean(channel.permissionsFor(client.user)?.has(PermissionFlagsBits.SendMessages)),
        canEmbed: Boolean(channel.permissionsFor(client.user)?.has(PermissionFlagsBits.EmbedLinks)),
        canAddReactions: Boolean(channel.permissionsFor(client.user)?.has(PermissionFlagsBits.AddReactions)),
      };
      diagnostics.ok = true;
    } catch (error) {
      diagnostics.ok = false;
      diagnostics.error = sanitizePublicErrorMessage(error);
      diagnostics.errorCode = error.code || null;
    }

    apiSuccess(res, diagnostics, { extra: { diagnostics } });
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
    const diagnostics = managedPublishDiagnostics({ managedPost, payload, targetChannelId, targetMessageId, description, buttons });

    try {
      await logActivity({
        type: 'managed_post',
        action: 'publish_attempt',
        actor: getActor(req),
        source: 'crm_api',
        entityType: 'managed_post',
        entityId: String(req.params.id),
        metadata: diagnostics,
      });
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
      await logActivity({ type: 'managed_post', action: 'published', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id), metadata: { messageId: message.id, channelId: targetChannelId, diagnostics } });
      const updated = serializeManagedPost(updateResult.rows[0]);
      apiSuccess(res, updated, { extra: { managedPost: updated } });
    } catch (error) {
      const publicMessage = sanitizePublicErrorMessage(error);
      await pool.query(
        `UPDATE discord_managed_posts SET status = 'error', last_error = $2, updated_at = NOW() WHERE id = $1`,
        [req.params.id, publicMessage]
      );
      await logActivity({
        type: 'managed_post',
        action: 'publish_failed',
        actor: getActor(req),
        source: 'crm_api',
        entityType: 'managed_post',
        entityId: String(req.params.id),
        metadata: { ...diagnostics, errorCode: error.code || null, errorName: error.name || null },
        errorMessage: publicMessage,
      });
      error.status = error.status || error.httpStatus || 400;
      error.code = error.code || 'MANAGED_POST_PUBLISH_FAILED';
      error.details = diagnostics;
      throw error;
    }
  }));

  router.post('/managed-posts/:id/sync-reactions', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('MANAGED_POST_NOT_FOUND', 'Managed post not found', 404);
    const managedPost = result.rows[0];
    const messageId = managedPost.message_id || managedPost.payload?.messageId || managedPost.payload?.message_id || null;
    const channelId = managedPost.channel_id || managedPost.payload?.channelId || null;
    if (!messageId) throw createApiError('MANAGED_POST_UNPUBLISHED', 'Managed page has not published a Discord message yet. Click Publish first, then sync reactions.', 400);
    if (!channelId) throw createApiError('MANAGED_POST_CHANNEL_MISSING', 'Managed page has no Discord channel selected.', 400);
    const channel = await fetchTextChannel(channelId);
    const message = await channel.messages.fetch(messageId);
    await addReactions(message, sanitizeReactions(managedPost.payload?.reactions, DEFAULT_MANAGED_REACTIONS).slice(0, 10));
    await logActivity({ type: 'managed_post', action: 'reaction_sync', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id), metadata: { messageId, channelId } });
    apiSuccess(res, { synced: true }, { extra: { synced: true } });
  }));

  router.delete('/managed-posts/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_managed_posts WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'managed_post', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'managed_post', entityId: String(req.params.id) });
    apiSuccess(res, { deleted: result.rowCount > 0 }, { extra: { deleted: result.rowCount > 0 } });
  }));

  router.get('/payout-feed/settings', asyncRoute(async (req, res) => {
    const overview = await getPayoutFeedOverview();
    apiSuccess(res, overview, { extra: { overview, settings: overview.settings } });
  }));

  router.patch('/payout-feed/settings', asyncRoute(async (req, res) => {
    const patch = sanitizePayoutSettingsPatch(req.body || {});
    const settings = await updatePayoutFeedSettings(patch, getActor(req));
    await logActivity({ type: 'payout_feed', action: 'settings_changed', actor: getActor(req), source: 'crm_api', metadata: { keys: Object.keys(patch) } });
    await startPayoutFeedScheduler();
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.post('/payout-feed/settings/switch-mode', asyncRoute(async (req, res) => {
    const mode = String(req.body.mode || '').toUpperCase();
    if (!PAYOUT_FEED_MODES.has(mode)) throw createApiError('PAYOUT_MODE_INVALID', 'Payout feed mode must be DISABLED, SIMULATION or LIVE', 400);
    const settings = await updatePayoutFeedSettings({
      mode,
      enabled: mode !== 'DISABLED',
      simulationEnabled: mode === 'SIMULATION',
    }, getActor(req));
    await logActivity({ type: 'payout_feed', action: 'mode_changed', actor: getActor(req), source: 'crm_api', metadata: { mode } });
    await startPayoutFeedScheduler();
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.post('/payout-feed/settings/test-channel', asyncRoute(async (req, res) => {
    const settings = await getPayoutFeedSettings();
    const channelId = req.body.channelId || settings.destinationChannelId;
    if (!channelId) throw createApiError('PAYOUT_CHANNEL_MISSING', 'Payout destination channel is not configured', 400);
    const channel = await fetchTextChannel(requireDiscordId(channelId, 'Payout channel ID'));
    const permissions = channel.permissionsFor(client.user);
    const result = {
      channelId: channel.id,
      channelName: channel.name || null,
      canView: permissions ? permissions.has(PermissionFlagsBits.ViewChannel) : true,
      canSend: permissions ? permissions.has(PermissionFlagsBits.SendMessages) : true,
      canMentionEveryone: permissions ? permissions.has(PermissionFlagsBits.MentionEveryone) : false,
      allowedMentionsDisabled: true,
    };
    await logActivity({ type: 'payout_feed', action: 'channel_tested', actor: getActor(req), source: 'crm_api', metadata: result });
    apiSuccess(res, result);
  }));

  router.post('/payout-feed/settings/send-test', asyncRoute(async (req, res) => {
    const settings = await getPayoutFeedSettings();
    const templates = await enabledPayoutTemplates('SIMULATION');
    const plan = generatePayoutWeekPlanPure(settings, { templates, weeklyTarget: 2 });
    const item = plan.items[0];
    const sent = await sendPayoutFeedItem({
      ...item,
      amount: item.amount,
      currency: item.currency,
      country_code: item.countryCode,
      country_name: item.countryName,
      display_name: item.displayName,
      flag: item.flag,
      template_id: item.templateId,
      body_template: templates.find(template => String(template.id) === String(item.templateId))?.bodyTemplate || DEFAULT_PAYOUT_TEMPLATES[0],
    }, { test: true, channelId: req.body.channelId || settings.destinationChannelId });
    await logActivity({ type: 'payout_feed', action: 'test_item_sent', actor: getActor(req), source: 'crm_api', metadata: sent });
    apiSuccess(res, { sent: true, ...sent });
  }));

  router.post('/payout-feed/live', asyncRoute(async (req, res) => {
    const live = sanitizeLivePayoutPayload(req.body || {});
    const result = await pool.query(
      `
      INSERT INTO discord_payout_feed_items
        (source_type, is_simulated, external_payout_id, first_name, last_name, display_name, country_code, country_name, flag, amount, currency, status, scheduled_for)
      VALUES ('LIVE', false, $1, $2, $3, $4, $5, $6, $7, $8, $9, 'SCHEDULED', $10)
      ON CONFLICT (external_payout_id) DO UPDATE
      SET first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          display_name = EXCLUDED.display_name,
          country_code = EXCLUDED.country_code,
          country_name = EXCLUDED.country_name,
          flag = EXCLUDED.flag,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          updated_at = NOW()
      RETURNING *
      `,
      [
        live.externalPayoutId,
        live.firstName,
        live.lastName,
        live.displayName,
        live.countryCode,
        live.countryName,
        live.flag,
        live.amount,
        live.currency,
        live.scheduledFor,
      ]
    );
    let sent = null;
    if (toBoolean(req.body.postNow ?? req.body.post_now, true)) {
      sent = await sendPayoutFeedItem(result.rows[0], { channelId: req.body.channelId || req.body.channel_id || null });
      await pool.query(
        `UPDATE discord_payout_feed_items SET status = 'POSTED', discord_message_id = $2, posted_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1`,
        [result.rows[0].id, sent.messageId]
      );
    }
    await logActivity({ type: 'payout_feed', action: 'live_payout_received', actor: getActor(req), source: 'crm_api', entityType: 'discord_payout_feed_item', entityId: String(result.rows[0].id), metadata: { externalPayoutId: live.externalPayoutId, posted: Boolean(sent) } });
    const refreshed = await pool.query(`SELECT i.*, NULL::text AS body_template FROM discord_payout_feed_items i WHERE i.id = $1`, [result.rows[0].id]);
    apiSuccess(res, serializePayoutItem(refreshed.rows[0]), { status: 201, extra: { item: serializePayoutItem(refreshed.rows[0]), sent } });
  }));

  router.get('/certificates/settings', asyncRoute(async (req, res) => {
    const settings = await getCertificateFeedSettings();
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.patch('/certificates/settings', asyncRoute(async (req, res) => {
    const settings = await updateCertificateFeedSettings(req.body || {}, getActor(req));
    await logActivity({ type: 'certificate_feed', action: 'settings_changed', actor: getActor(req), source: 'crm_api', metadata: { keys: Object.keys(req.body || {}) } });
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.post('/certificates/pass', asyncRoute(async (req, res) => {
    const result = await postCertificatePayload('pass', req.body || {});
    apiSuccess(res, result, { status: 201, extra: result });
  }));

  router.post('/certificates/payout', asyncRoute(async (req, res) => {
    const result = await postCertificatePayload('payout', req.body || {});
    apiSuccess(res, result, { status: 201, extra: result });
  }));

  router.get('/zealy/overview', asyncRoute(async (req, res) => {
    const overview = await getZealyOverview();
    apiSuccess(res, overview, { extra: { overview } });
  }));

  router.get('/zealy/settings', asyncRoute(async (req, res) => {
    const settings = await getZealySettings();
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.patch('/zealy/settings', asyncRoute(async (req, res) => {
    const settings = await updateZealySettings(req.body || {}, getActor(req));
    await logActivity({ type: 'zealy', action: 'settings_changed', actor: getActor(req), source: 'crm_api', metadata: { keys: Object.keys(req.body || {}) } });
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.get('/zealy/secrets', asyncRoute(async (req, res) => {
    const secrets = await getZealySecretStatus();
    apiSuccess(res, secrets, { extra: { secrets } });
  }));

  router.put('/zealy/secrets/:key', asyncRoute(async (req, res) => {
    const key = String(req.params.key || '').trim().toUpperCase();
    if (!['ZEALY_API_KEY', 'ZEALY_COMMUNITY_SUBDOMAIN', 'ZEALY_WEBHOOK_SECRET', 'ZEALY_API_BASE_URL'].includes(key)) throw createApiError('ZEALY_SECRET_UNSUPPORTED', 'Unsupported Zealy secret key.', 400);
    if (!req.body.value) throw createApiError('ZEALY_SECRET_VALUE_REQUIRED', 'Secret value is required.', 400);
    const encrypted = encryptSecretValue(req.body.value);
    const definition = getSecretDefinition(key);
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
      [key, encrypted.encryptedValue, encrypted.iv, encrypted.authTag, encrypted.lastFour, definition.requiresRestart, getActor(req)]
    );
    if (key === 'ZEALY_COMMUNITY_SUBDOMAIN') await updateZealySettings({ communitySubdomain: req.body.value }, getActor(req)).catch(() => {});
    await logActivity({ type: 'zealy', action: 'secret_upserted', actor: getActor(req), source: 'crm_api', entityType: 'secret', entityId: key });
    const secret = serializeSecret(result.rows[0]);
    apiSuccess(res, secret, { extra: { secret } });
  }));

  router.delete('/zealy/secrets/:key', asyncRoute(async (req, res) => {
    const key = String(req.params.key || '').trim().toUpperCase();
    const result = await pool.query(
      `UPDATE discord_secret_settings SET encrypted_value = NULL, iv = NULL, auth_tag = NULL, last_four = NULL, configured = false, updated_by = $2, updated_at = NOW() WHERE key = $1 RETURNING *`,
      [key, getActor(req)]
    );
    await logActivity({ type: 'zealy', action: 'secret_deleted', actor: getActor(req), source: 'crm_api', entityType: 'secret', entityId: key });
    apiSuccess(res, result.rowCount ? serializeSecret(result.rows[0]) : { key, configured: false });
  }));

  router.post('/zealy/secrets/:key/test', asyncRoute(async (req, res) => {
    const key = String(req.params.key || '').trim().toUpperCase();
    const value = await getStoredSecretValue(key);
    apiSuccess(res, { key, configured: Boolean(value), decryptable: Boolean(value) });
  }));

  router.post('/zealy/test-connection', asyncRoute(async (req, res) => {
    const result = await testZealyConnection();
    await logActivity({ type: 'zealy', action: 'connection_tested', actor: getActor(req), source: 'crm_api', metadata: { ok: result.ok } });
    apiSuccess(res, result, { extra: { result } });
  }));

  router.post('/zealy/sync', asyncRoute(async (req, res) => {
    const result = await syncZealyLeaderboard({ publish: toBoolean(req.body.publish, false) });
    await logActivity({ type: 'zealy', action: 'sync_requested', actor: getActor(req), source: 'crm_api', metadata: result });
    apiSuccess(res, result, { extra: { result } });
  }));

  router.get('/zealy/leaderboard', asyncRoute(async (req, res) => {
    const members = (await pool.query(`SELECT * FROM discord_zealy_members ORDER BY rank ASC NULLS LAST LIMIT $1`, [parsePositiveInt(req.query.limit, 25, 100)])).rows.map(serializeZealyMember);
    const preview = await buildZealyLeaderboardMessage().catch(error => sanitizePublicErrorMessage(error));
    apiSuccess(res, members, { total: members.length, extra: { members, preview } });
  }));

  router.post('/zealy/leaderboard/refresh', asyncRoute(async (req, res) => {
    const result = await syncZealyLeaderboard({ publish: false });
    apiSuccess(res, result, { extra: { result } });
  }));

  router.post('/zealy/leaderboard/publish', asyncRoute(async (req, res) => {
    const result = await syncZealyLeaderboard({ publish: true });
    apiSuccess(res, result, { extra: { result } });
  }));

  router.post('/zealy/leaderboard/recreate', asyncRoute(async (req, res) => {
    const result = await publishZealyLeaderboard({ recreate: true });
    apiSuccess(res, result, { extra: { result } });
  }));

  router.get('/zealy/templates', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_zealy_templates ORDER BY event_type ASC, id ASC`);
    const templates = result.rows.map(serializeZealyTemplate);
    apiSuccess(res, templates, { total: templates.length, extra: { templates, variableHelpers: ZEALY_TEMPLATE_VARIABLES, eventTypes: ZEALY_EVENT_TYPES } });
  }));

  router.post('/zealy/templates', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const result = await pool.query(
      `INSERT INTO discord_zealy_templates (name, event_type, enabled, title_template, body_template, colour, image_url, thumbnail_url, footer_text, buttons, reactions, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12) RETURNING *`,
      [body.name || 'Custom Zealy template', body.eventType || 'XP_EARNED', body.enabled !== false, body.titleTemplate || 'Zealy update', body.bodyTemplate || '{{user_display}} earned {{formatted_xp_delta}} XP', body.colour || '#f35023', body.imageUrl || null, body.thumbnailUrl || null, body.footerText || null, JSON.stringify(body.buttons || []), JSON.stringify(body.reactions || []), getActor(req)]
    );
    apiSuccess(res, serializeZealyTemplate(result.rows[0]), { status: 201, extra: { template: serializeZealyTemplate(result.rows[0]) } });
  }));

  router.patch('/zealy/templates/:id', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const current = await pool.query(`SELECT * FROM discord_zealy_templates WHERE id = $1`, [req.params.id]);
    if (!current.rowCount) throw createApiError('ZEALY_TEMPLATE_NOT_FOUND', 'Zealy template not found.', 404);
    const merged = { ...serializeZealyTemplate(current.rows[0]), ...body };
    const result = await pool.query(
      `UPDATE discord_zealy_templates SET name=$2,event_type=$3,enabled=$4,title_template=$5,body_template=$6,colour=$7,image_url=$8,thumbnail_url=$9,footer_text=$10,buttons=$11::jsonb,reactions=$12::jsonb,updated_by=$13,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id, merged.name, merged.eventType, merged.enabled !== false, merged.titleTemplate, merged.bodyTemplate, merged.colour || '#f35023', merged.imageUrl || null, merged.thumbnailUrl || null, merged.footerText || null, JSON.stringify(merged.buttons || []), JSON.stringify(merged.reactions || []), getActor(req)]
    );
    apiSuccess(res, serializeZealyTemplate(result.rows[0]), { extra: { template: serializeZealyTemplate(result.rows[0]) } });
  }));

  router.delete('/zealy/templates/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_zealy_templates WHERE id = $1 AND is_seeded = false`, [req.params.id]);
    apiSuccess(res, { deleted: result.rowCount > 0 });
  }));

  router.post('/zealy/templates/:id/preview', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_zealy_templates WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('ZEALY_TEMPLATE_NOT_FOUND', 'Zealy template not found.', 404);
    const sample = {
      event_type: result.rows[0].event_type,
      source: 'PREVIEW',
      zealy_name: 'TraderTwo',
      discord_username: 'TraderTwo',
      xp_delta: 125,
      current_xp: 4250,
      rank_before: 12,
      rank_after: 8,
      quest_name: 'Complete onboarding',
      reward_name: 'TTT reward',
      metadata: { milestone: 1000 },
      occurred_at: new Date(),
    };
    const values = zealyEventValues(sample);
    apiSuccess(res, { title: renderZealyTemplateString(result.rows[0].title_template, values), body: renderZealyTemplateString(result.rows[0].body_template, values), values });
  }));

  router.post('/zealy/templates/:id/test-send', asyncRoute(async (req, res) => {
    const settings = await getZealySettings();
    const template = await pool.query(`SELECT * FROM discord_zealy_templates WHERE id = $1`, [req.params.id]);
    if (!template.rowCount) throw createApiError('ZEALY_TEMPLATE_NOT_FOUND', 'Zealy template not found.', 404);
    const event = await insertZealyEvent({
      providerEventId: `test:${req.params.id}:${Date.now()}`,
      eventType: template.rows[0].event_type,
      source: 'TEST',
      zealyUserId: 'test-user',
      xpDelta: 125,
      currentXp: 4250,
      rankAfter: 8,
      questName: 'Complete onboarding',
      rewardName: 'TTT reward',
      metadata: { zealyName: 'TraderTwo', milestone: 1000 },
      occurredAt: new Date(),
    });
    const sent = await sendZealyEvent(event, { channelId: req.body.channelId || settings.rewardFeedChannelId });
    apiSuccess(res, sent, { extra: { sent } });
  }));

  router.get('/zealy/events', asyncRoute(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.eventType) { params.push(req.query.eventType); where.push(`event_type = $${params.length}`); }
    if (req.query.status) { params.push(req.query.status); where.push(`status = $${params.length}`); }
    if (req.query.source) { params.push(req.query.source); where.push(`source = $${params.length}`); }
    if (req.query.search) { params.push(`%${String(req.query.search).toLowerCase()}%`); where.push(`(LOWER(COALESCE(quest_name,'')) LIKE $${params.length} OR LOWER(COALESCE(reward_name,'')) LIKE $${params.length} OR LOWER(COALESCE(zealy_user_id,'')) LIKE $${params.length})`); }
    const limit = parsePositiveInt(req.query.limit, 50, 200);
    params.push(limit);
    const result = await pool.query(`SELECT * FROM discord_zealy_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY occurred_at DESC LIMIT $${params.length}`, params);
    const events = result.rows.map(serializeZealyEvent);
    apiSuccess(res, events, { total: events.length, extra: { events } });
  }));

  router.get('/zealy/events/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_zealy_events WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('ZEALY_EVENT_NOT_FOUND', 'Zealy event not found.', 404);
    apiSuccess(res, serializeZealyEvent(result.rows[0]), { extra: { event: serializeZealyEvent(result.rows[0]) } });
  }));

  router.post('/zealy/events/:id/retry', asyncRoute(async (req, res) => {
    const result = await pool.query(`UPDATE discord_zealy_events SET status = 'PENDING', last_error = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!result.rowCount) throw createApiError('ZEALY_EVENT_NOT_FOUND', 'Zealy event not found.', 404);
    const sent = await sendZealyEvent(result.rows[0]);
    apiSuccess(res, sent, { extra: { sent } });
  }));

  router.post('/zealy/test-reward-event', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const event = await insertZealyEvent({
      providerEventId: `manual-test:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
      eventType: body.eventType || 'XP_EARNED',
      source: 'TEST',
      zealyUserId: body.zealyUserId || 'test-user',
      discordUserId: body.discordUserId || null,
      xpDelta: Number(body.xpDelta || 125),
      currentXp: Number(body.currentXp || 4250),
      rankAfter: Number(body.rank || 8),
      questName: body.questName || 'Complete onboarding',
      rewardName: body.rewardName || null,
      metadata: { zealyName: body.zealyName || 'TraderTwo', milestone: body.milestone || 1000 },
      occurredAt: new Date(),
    });
    const sent = await sendZealyEvent(event, { channelId: body.channelId || null });
    apiSuccess(res, { event: serializeZealyEvent(event), sent }, { status: 201, extra: { event: serializeZealyEvent(event), sent } });
  }));

  router.get('/payout-feed/weeks/current', asyncRoute(async (req, res) => {
    const settings = await getPayoutFeedSettings();
    const { weekStart } = localWeekRange(new Date(), settings.timezone);
    const result = await pool.query(`SELECT * FROM discord_payout_feed_weeks WHERE mode = $1 AND week_start = $2 LIMIT 1`, [settings.mode === 'LIVE' ? 'LIVE' : 'SIMULATION', weekStart]);
    apiSuccess(res, result.rows[0] ? serializePayoutWeek(result.rows[0]) : null, { extra: { week: result.rows[0] ? serializePayoutWeek(result.rows[0]) : null } });
  }));

  router.get('/payout-feed/weeks', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit || req.query.pageSize, 20, 100);
    const offset = (page - 1) * limit;
    const [result, count] = await Promise.all([
      pool.query(`SELECT * FROM discord_payout_feed_weeks ORDER BY week_start DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS count FROM discord_payout_feed_weeks`),
    ]);
    const weeks = result.rows.map(serializePayoutWeek);
    apiSuccess(res, weeks, { page, pageSize: limit, total: count.rows[0]?.count || 0, extra: { weeks } });
  }));

  router.post('/payout-feed/weeks/generate-test', asyncRoute(async (req, res) => {
    const settings = normalizePayoutSettings({ ...(await getPayoutFeedSettings()), ...(req.body || {}) });
    const templates = await enabledPayoutTemplates('SIMULATION');
    const plan = generatePayoutWeekPlanPure(settings, { templates, weeklyTarget: req.body.weeklyTarget || undefined });
    apiSuccess(res, {
      weekStart: plan.weekStart,
      weekEnd: plan.weekEnd,
      weeklyTarget: plan.weeklyTarget,
      wednesdayTarget: plan.wednesdayTarget,
      thursdayTarget: plan.thursdayTarget,
      items: plan.items,
    });
  }));

  router.post('/payout-feed/weeks/current/regenerate', asyncRoute(async (req, res) => {
    const result = await ensurePayoutWeek({ force: true, actor: getActor(req) });
    await startPayoutFeedScheduler();
    apiSuccess(res, result, { extra: { result } });
  }));

  router.post('/payout-feed/weeks/current/pause', asyncRoute(async (req, res) => {
    const settings = await updatePayoutFeedSettings({ enabled: false }, getActor(req));
    await logActivity({ type: 'payout_feed', action: 'paused', actor: getActor(req), source: 'crm_api' });
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.post('/payout-feed/weeks/current/resume', asyncRoute(async (req, res) => {
    const settings = await updatePayoutFeedSettings({ enabled: true, simulationEnabled: true, mode: 'SIMULATION' }, getActor(req));
    await startPayoutFeedScheduler();
    await logActivity({ type: 'payout_feed', action: 'resumed', actor: getActor(req), source: 'crm_api' });
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.get('/payout-feed/items', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit || req.query.pageSize, 50, 200);
    const params = [];
    const where = [];
    if (req.query.status) { params.push(String(req.query.status).toUpperCase()); where.push(`i.status = $${params.length}`); }
    if (req.query.sourceType) { params.push(String(req.query.sourceType).toUpperCase()); where.push(`i.source_type = $${params.length}`); }
    if (req.query.weekId) { params.push(req.query.weekId); where.push(`i.week_id = $${params.length}`); }
    if (req.query.from) { params.push(new Date(String(req.query.from))); where.push(`i.scheduled_for >= $${params.length}`); }
    if (req.query.to) { params.push(new Date(String(req.query.to))); where.push(`i.scheduled_for <= $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, (page - 1) * limit);
    const result = await pool.query(
      `
      SELECT i.*, t.body_template
      FROM discord_payout_feed_items i
      LEFT JOIN discord_payout_feed_templates t ON t.id = i.template_id
      ${whereSql}
      ORDER BY i.scheduled_for DESC NULLS LAST, i.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_payout_feed_items i ${whereSql}`, params.slice(0, -2));
    const items = result.rows.map(serializePayoutItem);
    apiSuccess(res, items, { page, pageSize: limit, total: count.rows[0]?.count || 0, extra: { items } });
  }));

  router.get('/payout-feed/items/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT i.*, t.body_template FROM discord_payout_feed_items i LEFT JOIN discord_payout_feed_templates t ON t.id = i.template_id WHERE i.id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) throw createApiError('PAYOUT_ITEM_NOT_FOUND', 'Payout feed item not found', 404);
    apiSuccess(res, serializePayoutItem(result.rows[0]));
  }));

  router.post('/payout-feed/items/:id/post-now', asyncRoute(async (req, res) => {
    const claim = await pool.query(
      `
      UPDATE discord_payout_feed_items
      SET status = 'PROCESSING', attempt_count = attempt_count + 1, updated_at = NOW()
      WHERE id = $1 AND status IN ('GENERATED', 'SCHEDULED', 'FAILED', 'SKIPPED')
      RETURNING *
      `,
      [req.params.id]
    );
    if (!claim.rowCount) throw createApiError('PAYOUT_ITEM_POST_UNAVAILABLE', 'Only unposted payout feed items can be posted manually', 400);
    const item = claim.rows[0];
    try {
      const sent = await sendPayoutFeedItem(item);
      const updated = await pool.query(
        `UPDATE discord_payout_feed_items SET status = 'POSTED', discord_message_id = $2, posted_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [item.id, sent.messageId]
      );
      await refreshPayoutWeekCounts(item.week_id);
      await logActivity({ type: 'payout_feed', action: 'item_posted_manually', actor: getActor(req), source: 'crm_api', entityType: 'discord_payout_feed_item', entityId: String(item.id), metadata: sent });
      apiSuccess(res, serializePayoutItem(updated.rows[0]), { extra: { item: serializePayoutItem(updated.rows[0]), sent } });
    } catch (error) {
      await pool.query(`UPDATE discord_payout_feed_items SET status = 'FAILED', last_error = $2, updated_at = NOW() WHERE id = $1`, [item.id, sanitizePublicErrorMessage(error)]);
      await refreshPayoutWeekCounts(item.week_id);
      throw error;
    }
  }));

  router.post('/payout-feed/items/:id/retry', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `UPDATE discord_payout_feed_items SET status = 'SCHEDULED', scheduled_for = COALESCE($2::timestamptz, NOW()), last_error = NULL, updated_at = NOW() WHERE id = $1 AND status IN ('FAILED', 'SKIPPED', 'CANCELLED') RETURNING *`,
      [req.params.id, req.body.scheduledFor ? new Date(req.body.scheduledFor) : null]
    );
    if (!result.rowCount) throw createApiError('PAYOUT_ITEM_RETRY_UNAVAILABLE', 'Only failed, skipped or cancelled payout feed items can be retried', 400);
    await refreshPayoutWeekCounts(result.rows[0].week_id);
    await logActivity({ type: 'payout_feed', action: 'item_retry_requested', actor: getActor(req), source: 'crm_api', entityType: 'discord_payout_feed_item', entityId: String(req.params.id) });
    apiSuccess(res, serializePayoutItem(result.rows[0]));
  }));

  router.post('/payout-feed/items/:id/skip', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `UPDATE discord_payout_feed_items SET status = 'SKIPPED', last_error = 'Skipped by CRM admin', updated_at = NOW() WHERE id = $1 AND status IN ('GENERATED', 'SCHEDULED', 'FAILED') RETURNING *`,
      [req.params.id]
    );
    if (!result.rowCount) throw createApiError('PAYOUT_ITEM_SKIP_UNAVAILABLE', 'Only unposted payout feed items can be skipped', 400);
    await refreshPayoutWeekCounts(result.rows[0].week_id);
    await logActivity({ type: 'payout_feed', action: 'item_skipped', actor: getActor(req), source: 'crm_api', entityType: 'discord_payout_feed_item', entityId: String(req.params.id) });
    apiSuccess(res, serializePayoutItem(result.rows[0]));
  }));

  router.get('/payout-feed/templates', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_payout_feed_templates ORDER BY source_type ASC, id ASC`);
    const templates = result.rows.map(serializePayoutTemplate);
    apiSuccess(res, templates, { total: templates.length, extra: { templates } });
  }));

  router.post('/payout-feed/templates', asyncRoute(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const bodyTemplate = String(req.body.bodyTemplate || req.body.body_template || '').trim();
    if (!name) throw createApiError('PAYOUT_TEMPLATE_NAME_REQUIRED', 'Template name is required', 400);
    if (!bodyTemplate) throw createApiError('PAYOUT_TEMPLATE_BODY_REQUIRED', 'Template body is required', 400);
    validateTextLength(bodyTemplate, 1800, 'Payout template body');
    const sourceType = String(req.body.sourceType || 'SIMULATION').toUpperCase();
    const result = await pool.query(
      `
      INSERT INTO discord_payout_feed_templates (name, enabled, weight, body_template, source_type)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [name, toBoolean(req.body.enabled, true), Math.max(1, Number(req.body.weight || 1)), bodyTemplate, sourceType]
    );
    await logActivity({ type: 'payout_feed_template', action: 'created', actor: getActor(req), source: 'crm_api', entityType: 'discord_payout_feed_template', entityId: String(result.rows[0].id) });
    const template = serializePayoutTemplate(result.rows[0]);
    apiSuccess(res, template, { status: 201, extra: { template } });
  }));

  router.patch('/payout-feed/templates/:id', asyncRoute(async (req, res) => {
    const current = await pool.query(`SELECT * FROM discord_payout_feed_templates WHERE id = $1`, [req.params.id]);
    if (!current.rowCount) throw createApiError('PAYOUT_TEMPLATE_NOT_FOUND', 'Payout template not found', 404);
    const name = String(req.body.name ?? current.rows[0].name).trim();
    const bodyTemplate = String(req.body.bodyTemplate ?? req.body.body_template ?? current.rows[0].body_template).trim();
    if (!name || !bodyTemplate) throw createApiError('PAYOUT_TEMPLATE_INVALID', 'Template name and body are required', 400);
    const result = await pool.query(
      `
      UPDATE discord_payout_feed_templates
      SET name = $2, enabled = $3, weight = $4, body_template = $5, source_type = $6, updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [req.params.id, name, toBoolean(req.body.enabled, current.rows[0].enabled), Math.max(1, Number(req.body.weight || current.rows[0].weight || 1)), bodyTemplate, String(req.body.sourceType || current.rows[0].source_type).toUpperCase()]
    );
    await logActivity({ type: 'payout_feed_template', action: 'updated', actor: getActor(req), source: 'crm_api', entityType: 'discord_payout_feed_template', entityId: String(req.params.id) });
    const template = serializePayoutTemplate(result.rows[0]);
    apiSuccess(res, template, { extra: { template } });
  }));

  router.delete('/payout-feed/templates/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`DELETE FROM discord_payout_feed_templates WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'payout_feed_template', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'discord_payout_feed_template', entityId: String(req.params.id) });
    apiSuccess(res, { deleted: result.rowCount > 0 });
  }));

  router.post('/payout-feed/templates/:id/preview', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_payout_feed_templates WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('PAYOUT_TEMPLATE_NOT_FOUND', 'Payout template not found', 404);
    const sample = {
      flag: flagFromCountryCode(req.body.countryCode || 'GB'),
      display_name: req.body.displayName || 'Alex T.',
      amount: req.body.amount || 725,
      currency: req.body.currency || 'USD',
      formatted_amount: formatPayoutAmount(req.body.amount || 725, req.body.currency || 'USD'),
      country_code: req.body.countryCode || 'GB',
      country_name: payoutCountryName(req.body.countryCode || 'GB'),
    };
    apiSuccess(res, { content: renderPayoutTemplate(result.rows[0].body_template, sample), values: sample, template: serializePayoutTemplate(result.rows[0]) });
  }));

  router.get('/news/overview', asyncRoute(async (req, res) => {
    const overview = await getNewsOverview();
    apiSuccess(res, overview, { extra: { overview } });
  }));

  router.get('/news/settings', asyncRoute(async (req, res) => {
    const [settings, overview] = await Promise.all([getNewsSettings(), getNewsOverview()]);
    apiSuccess(res, { ...settings, ...overview }, { extra: { settings, overview } });
  }));

  router.patch('/news/settings', asyncRoute(async (req, res) => {
    const patch = sanitizeNewsSettingsPatch(req.body || {});
    const settings = await updateNewsSettings(patch, getActor(req));
    await logActivity({ type: 'news', action: 'settings_changed', actor: getActor(req), source: 'crm_api', metadata: { keys: Object.keys(patch) } });
    await startNewsSchedulers();
    apiSuccess(res, settings, { extra: { settings } });
  }));

  router.post('/news/settings/test-feed', asyncRoute(async (req, res) => {
    const settings = await getNewsSettings();
    const feedUrl = req.body.feedUrl || settings.feedUrl;
    const payload = await fetchNewsFeed(feedUrl, { retries: 0 });
    const events = normalizeForexFactoryPayload(payload, settings.provider);
    await logActivity({ type: 'news', action: 'feed_tested', actor: getActor(req), source: 'crm_api', metadata: { eventsReceived: events.length } });
    apiSuccess(res, { ok: true, eventsReceived: events.length, sample: events.slice(0, 5) });
  }));

  router.post('/news/settings/test-channel', asyncRoute(async (req, res) => {
    const settings = await getNewsSettings();
    const channelId = req.body.channelId || settings.destinationChannelId;
    if (!channelId) throw createApiError('NEWS_CHANNEL_MISSING', 'News destination channel is not configured', 400);
    const check = await validateNewsChannel(requireDiscordId(channelId, 'News channel ID'), toBoolean(req.body.mentionEveryone, false));
    const result = {
      channelId: check.channel.id,
      channelName: check.channel.name,
      canMentionEveryone: check.canMentionEveryone,
      canAddReactions: check.canAddReactions,
      willMentionEveryone: check.mentionEveryone,
    };
    await logActivity({ type: 'news', action: 'channel_tested', actor: getActor(req), source: 'crm_api', metadata: result });
    apiSuccess(res, result);
  }));

  router.post('/news/settings/send-test-alert', asyncRoute(async (req, res) => {
    const settings = await getNewsSettings();
    const upcoming = await pool.query(
      `SELECT * FROM discord_news_events WHERE scheduled_at >= NOW() ORDER BY scheduled_at ASC LIMIT 1`
    );
    const event = upcoming.rows[0] || {
      id: null,
      title: req.body.title || 'Test Economic Event',
      currency: req.body.currency || 'USD',
      country: req.body.country || 'United States',
      impact: normalizeNewsImpact(req.body.impact || 'HIGH'),
      scheduled_at: new Date(Date.now() + 15 * 60 * 1000),
      forecast: req.body.forecast || 'N/A',
      previous: req.body.previous || 'N/A',
      actual: null,
      source_url: null,
    };
    const alert = {
      id: 'test',
      news_event_id: event.id,
      alert_type: req.body.alertType || NEWS_ADVANCE_ALERT_TYPES[event.impact] || 'HIGH_IMPACT_ADVANCE',
      scheduled_for: new Date(),
      destination_channel_id: req.body.channelId || settings.destinationChannelId,
      mention_everyone: toBoolean(req.body.mentionEveryone, false),
      template_id: req.body.templateId || null,
      metadata: { minutesBefore: req.body.minutesBefore || 15, date: localDateKey(new Date(), settings.timezone) },
    };
    const template = await getNewsTemplateForAlert(alert.alert_type, settings, alert.template_id);
    if (!template) throw createApiError('NEWS_TEMPLATE_MISSING', `No enabled template found for ${alert.alert_type}`, 400);
    if (!event.id) {
      const values = newsTemplateValues(event, settings, { minutesBefore: alert.metadata.minutesBefore });
      const embed = buildNewsEmbed(template, event, settings, { minutesBefore: alert.metadata.minutesBefore });
      const channel = await validateNewsChannel(alert.destination_channel_id, alert.mention_everyone);
      const message = await channel.channel.send({
        content: channel.mentionEveryone ? '@everyone' : '',
        embeds: [embed],
        components: buildButtonRows(template.buttons || []),
        allowedMentions: channel.mentionEveryone ? { parse: ['everyone'] } : { parse: [] },
      });
      await addReactions(message, sanitizeReactions(template.reactions, settings.defaultReactions));
      await logActivity({ type: 'news', action: 'test_alert_sent', actor: getActor(req), source: 'crm_api', metadata: { channelId: alert.destination_channel_id, messageId: message.id, title: values.title } });
      apiSuccess(res, { sent: true, messageId: message.id, channelId: alert.destination_channel_id });
      return;
    }
    const sent = await sendNewsAlert(alert, { test: true });
    await logActivity({ type: 'news', action: 'test_alert_sent', actor: getActor(req), source: 'crm_api', metadata: sent });
    apiSuccess(res, { sent: true, ...sent });
  }));

  router.get('/news/templates', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit || req.query.pageSize, 100, 200);
    const offset = (page - 1) * limit;
    const [result, count] = await Promise.all([
      pool.query(`SELECT * FROM discord_news_templates ORDER BY template_type ASC, updated_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS count FROM discord_news_templates`),
    ]);
    const templates = result.rows.map(serializeNewsTemplate);
    apiSuccess(res, templates, { page, pageSize: limit, total: count.rows[0]?.count || 0, extra: { templates, variableHelpers: NEWS_TEMPLATE_VARIABLES } });
  }));

  router.post('/news/templates', asyncRoute(async (req, res) => {
    const payload = sanitizeNewsTemplatePayload(req.body);
    const result = await pool.query(
      `
      INSERT INTO discord_news_templates
        (name, template_type, enabled, title_template, body_template, colour, image_url, thumbnail_url, footer_text, buttons, reactions, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
      RETURNING *
      `,
      [payload.name, payload.templateType, payload.enabled, payload.titleTemplate, payload.bodyTemplate, payload.colour, payload.imageUrl, payload.thumbnailUrl, payload.footerText, JSON.stringify(payload.buttons), JSON.stringify(payload.reactions), getActor(req)]
    );
    await logActivity({ type: 'news_template', action: 'created', actor: getActor(req), source: 'crm_api', entityType: 'discord_news_template', entityId: String(result.rows[0].id) });
    const template = serializeNewsTemplate(result.rows[0]);
    apiSuccess(res, template, { status: 201, extra: { template } });
  }));

  router.get('/news/templates/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_news_templates WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('NEWS_TEMPLATE_NOT_FOUND', 'News template not found', 404);
    const template = serializeNewsTemplate(result.rows[0]);
    apiSuccess(res, template, { extra: { template } });
  }));

  router.patch('/news/templates/:id', asyncRoute(async (req, res) => {
    const current = await pool.query(`SELECT * FROM discord_news_templates WHERE id = $1`, [req.params.id]);
    if (!current.rowCount) throw createApiError('NEWS_TEMPLATE_NOT_FOUND', 'News template not found', 404);
    const payload = sanitizeNewsTemplatePayload(req.body, current.rows[0]);
    const result = await pool.query(
      `
      UPDATE discord_news_templates
      SET name = $2,
          template_type = $3,
          enabled = $4,
          title_template = $5,
          body_template = $6,
          colour = $7,
          image_url = $8,
          thumbnail_url = $9,
          footer_text = $10,
          buttons = $11::jsonb,
          reactions = $12::jsonb,
          updated_by = $13,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [req.params.id, payload.name, payload.templateType, payload.enabled, payload.titleTemplate, payload.bodyTemplate, payload.colour, payload.imageUrl, payload.thumbnailUrl, payload.footerText, JSON.stringify(payload.buttons), JSON.stringify(payload.reactions), getActor(req)]
    );
    await logActivity({ type: 'news_template', action: 'updated', actor: getActor(req), source: 'crm_api', entityType: 'discord_news_template', entityId: String(req.params.id) });
    const template = serializeNewsTemplate(result.rows[0]);
    apiSuccess(res, template, { extra: { template } });
  }));

  router.delete('/news/templates/:id', asyncRoute(async (req, res) => {
    const assigned = await pool.query(
      `
      SELECT 1 FROM discord_news_settings
      WHERE high_impact_template_id = $1
         OR medium_impact_template_id = $1
         OR low_impact_template_id = $1
         OR daily_summary_template_id = $1
         OR event_time_template_id = $1
      LIMIT 1
      `,
      [req.params.id]
    );
    if (assigned.rowCount && req.query.force !== 'true') {
      throw createApiError('NEWS_TEMPLATE_ASSIGNED', 'Template is actively assigned. Reassign it or pass force=true.', 409);
    }
    const result = await pool.query(`DELETE FROM discord_news_templates WHERE id = $1`, [req.params.id]);
    await logActivity({ type: 'news_template', action: 'deleted', actor: getActor(req), source: 'crm_api', entityType: 'discord_news_template', entityId: String(req.params.id) });
    apiSuccess(res, { deleted: result.rowCount > 0 });
  }));

  router.post('/news/templates/:id/preview', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_news_templates WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('NEWS_TEMPLATE_NOT_FOUND', 'News template not found', 404);
    const settings = await getNewsSettings();
    const sampleEvent = {
      title: req.body.title || 'US CPI y/y',
      currency: req.body.currency || 'USD',
      country: req.body.country || 'United States',
      impact: req.body.impact || 'HIGH',
      scheduledAt: new Date(Date.now() + 15 * 60 * 1000),
      forecast: req.body.forecast || '3.1%',
      previous: req.body.previous || '3.0%',
      actual: req.body.actual || null,
      sourceUrl: DEFAULT_NEWS_FEED_URL,
    };
    const values = newsTemplateValues(sampleEvent, settings, { minutesBefore: req.body.minutesBefore || 15, eventList: buildDailyEventList([sampleEvent]), eventCount: 1 });
    apiSuccess(res, {
      title: renderNewsTemplateString(result.rows[0].title_template, values),
      body: renderNewsTemplateString(result.rows[0].body_template, values),
      values,
      template: serializeNewsTemplate(result.rows[0]),
    });
  }));

  router.post('/news/templates/:id/test-send', asyncRoute(async (req, res) => {
    req.body.templateId = req.params.id;
    req.body.alertType = req.body.alertType || null;
    const template = await pool.query(`SELECT template_type FROM discord_news_templates WHERE id = $1`, [req.params.id]);
    if (!template.rowCount) throw createApiError('NEWS_TEMPLATE_NOT_FOUND', 'News template not found', 404);
    req.body.alertType = req.body.alertType || template.rows[0].template_type;
    const settings = await getNewsSettings();
    const event = {
      id: null,
      title: req.body.title || 'Test Economic Event',
      currency: req.body.currency || 'USD',
      country: req.body.country || 'United States',
      impact: normalizeNewsImpact(req.body.impact || 'HIGH'),
      scheduled_at: new Date(Date.now() + 15 * 60 * 1000),
      forecast: req.body.forecast || 'N/A',
      previous: req.body.previous || 'N/A',
      actual: null,
      source_url: null,
    };
    const channel = await validateNewsChannel(req.body.channelId || settings.destinationChannelId, toBoolean(req.body.mentionEveryone, false));
    const embed = buildNewsEmbed((await pool.query(`SELECT * FROM discord_news_templates WHERE id = $1`, [req.params.id])).rows[0], event, settings, { minutesBefore: req.body.minutesBefore || 15 });
    const message = await channel.channel.send({ content: channel.mentionEveryone ? '@everyone' : '', embeds: [embed], allowedMentions: channel.mentionEveryone ? { parse: ['everyone'] } : { parse: [] } });
    apiSuccess(res, { sent: true, messageId: message.id, channelId: channel.channel.id });
  }));

  router.post('/news/events/sync', asyncRoute(async (req, res) => {
    const result = await syncNewsFeed({ actor: getActor(req), manual: true });
    apiSuccess(res, result, { extra: { result } });
  }));

  router.get('/news/events', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit || req.query.pageSize, 50, 200);
    const params = [];
    const where = [];
    if (req.query.currency) { params.push(String(req.query.currency).toUpperCase()); where.push(`currency = $${params.length}`); }
    if (req.query.impact) { params.push(normalizeNewsImpact(req.query.impact)); where.push(`impact = $${params.length}`); }
    if (req.query.search) { params.push(`%${String(req.query.search).trim()}%`); where.push(`title ILIKE $${params.length}`); }
    if (req.query.from) { params.push(new Date(String(req.query.from))); where.push(`scheduled_at >= $${params.length}`); }
    if (req.query.to) { params.push(new Date(String(req.query.to))); where.push(`scheduled_at <= $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, (page - 1) * limit);
    const result = await pool.query(`SELECT * FROM discord_news_events ${whereSql} ORDER BY scheduled_at ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_news_events ${whereSql}`, params.slice(0, -2));
    const events = result.rows.map(serializeNewsEvent);
    apiSuccess(res, events, { page, pageSize: limit, total: count.rows[0]?.count || 0, extra: { events } });
  }));

  router.get('/news/events/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM discord_news_events WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) throw createApiError('NEWS_EVENT_NOT_FOUND', 'News event not found', 404);
    const alerts = await pool.query(`SELECT * FROM discord_news_alerts WHERE news_event_id = $1 ORDER BY scheduled_for ASC`, [req.params.id]);
    apiSuccess(res, { event: serializeNewsEvent(result.rows[0]), alerts: alerts.rows.map(serializeNewsAlert) });
  }));

  router.get('/news/alerts', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit || req.query.pageSize, 50, 200);
    const params = [];
    const where = [];
    if (req.query.status) { params.push(String(req.query.status).toUpperCase()); where.push(`a.status = $${params.length}`); }
    if (req.query.impact) { params.push(normalizeNewsImpact(req.query.impact)); where.push(`e.impact = $${params.length}`); }
    if (req.query.currency) { params.push(String(req.query.currency).toUpperCase()); where.push(`e.currency = $${params.length}`); }
    if (req.query.search) { params.push(`%${String(req.query.search).trim()}%`); where.push(`e.title ILIKE $${params.length}`); }
    if (req.query.from) { params.push(new Date(String(req.query.from))); where.push(`a.scheduled_for >= $${params.length}`); }
    if (req.query.to) { params.push(new Date(String(req.query.to))); where.push(`a.scheduled_for <= $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, (page - 1) * limit);
    const result = await pool.query(
      `
      SELECT a.*, e.title, e.provider, e.provider_event_key, e.currency, e.country, e.impact, e.scheduled_at, e.forecast, e.previous, e.actual, e.source_url, e.first_seen_at, e.last_seen_at, e.cancelled
      FROM discord_news_alerts a
      LEFT JOIN discord_news_events e ON e.id = a.news_event_id
      ${whereSql}
      ORDER BY a.scheduled_for DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM discord_news_alerts a LEFT JOIN discord_news_events e ON e.id = a.news_event_id ${whereSql}`, params.slice(0, -2));
    const alerts = result.rows.map(serializeNewsAlert);
    apiSuccess(res, alerts, { page, pageSize: limit, total: count.rows[0]?.count || 0, extra: { alerts } });
  }));

  router.get('/news/alerts/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `
      SELECT a.*, e.title, e.provider, e.provider_event_key, e.currency, e.country, e.impact, e.scheduled_at, e.forecast, e.previous, e.actual, e.source_url, e.first_seen_at, e.last_seen_at, e.cancelled
      FROM discord_news_alerts a
      LEFT JOIN discord_news_events e ON e.id = a.news_event_id
      WHERE a.id = $1
      `,
      [req.params.id]
    );
    if (!result.rowCount) throw createApiError('NEWS_ALERT_NOT_FOUND', 'News alert not found', 404);
    apiSuccess(res, serializeNewsAlert(result.rows[0]));
  }));

  router.post('/news/alerts/:id/retry', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `UPDATE discord_news_alerts SET status = 'PENDING', scheduled_for = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1 AND status IN ('FAILED', 'SKIPPED', 'CANCELLED') RETURNING *`,
      [req.params.id]
    );
    if (!result.rowCount) throw createApiError('NEWS_ALERT_RETRY_UNAVAILABLE', 'Only failed, skipped or cancelled alerts can be retried', 400);
    await logActivity({ type: 'news', action: 'alert_retry_requested', actor: getActor(req), source: 'crm_api', entityType: 'discord_news_alert', entityId: String(req.params.id) });
    apiSuccess(res, serializeNewsAlert(result.rows[0]));
  }));

  router.post('/news/alerts/:id/cancel', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `UPDATE discord_news_alerts SET status = 'CANCELLED', last_error = 'Cancelled by CRM admin', updated_at = NOW() WHERE id = $1 AND status IN ('PENDING', 'FAILED') RETURNING *`,
      [req.params.id]
    );
    if (!result.rowCount) throw createApiError('NEWS_ALERT_CANCEL_UNAVAILABLE', 'Only pending or failed alerts can be cancelled', 400);
    await logActivity({ type: 'news', action: 'alert_cancelled', actor: getActor(req), source: 'crm_api', entityType: 'discord_news_alert', entityId: String(req.params.id) });
    apiSuccess(res, serializeNewsAlert(result.rows[0]));
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
async function startBot() {
  await initDB();
  startCRMStatsServer();
  startZealySchedulers();
  await registerCommands();
  await client.login(DISCORD_TOKEN);
}

if (require.main === module) {
  startBot().catch(error => {
    console.error('Bot startup failed:', error);
    process.exit(1);
  });
}

module.exports = {
  normalizeNewsImpact,
  normalizeForexFactoryEvent,
  normalizeForexFactoryPayload,
  stableNewsEventKey,
  validateNewsFeedUrl,
  newsEventPassesFilters,
  renderNewsTemplateString,
  newsTemplateValues,
  buildAllowedMentions,
  DEFAULT_NEWS_SETTINGS,
  DEFAULT_NEWS_FEED_URL,
  DEFAULT_NEWS_TEMPLATES,
  localDateKey,
  generatePayoutWeekPlanPure,
  formatPayoutAmount,
  formatPayoutRewardAmount,
  flagFromCountryCode,
  discordFlagCode,
  renderPayoutTemplate,
  renderUniformPayoutMessage,
  normalizeZealySubdomain,
  normalizeZealyLeaderboard,
  detectZealyDeltaEvents,
  detectZealyMilestones,
  renderZealyTemplateString,
  zealyEventValues,
  zealyCapabilityMatrix,
  verifyZealyWebhookSecret,
  ZEALY_DEFAULT_TEMPLATES,
  ZEALY_DEFAULT_SETTINGS,
  ZEALY_DEFAULT_MILESTONES,
  normalizePayoutSettings,
  localDateParts,
  DEFAULT_PAYOUT_SETTINGS,
  DEFAULT_PAYOUT_TEMPLATES,
  PAYOUT_POSTING_DAYS,
};
