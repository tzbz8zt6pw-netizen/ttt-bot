require('dotenv').config();

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
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const parser = new Parser();

const BRAND_COLOR = 0xf35023;
const BRAND_NAME = 'TTT Markets';
const BRAND_FOOTER = 'TTT Markets • Official Alerts';
const YT_FOOTER = 'TTT Markets • YouTube Alerts';
const LOGO_URL = 'https://tttmarkets.com/wp-content/uploads/2025/09/cropped-TTT-Logo.png';
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

const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    lastVideoId: null,
    subscribers: [],
    welcomedUsers: [],
    stats: {
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
    },
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return defaultData();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      lastVideoId: parsed.lastVideoId || null,
      subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
      welcomedUsers: Array.isArray(parsed.welcomedUsers) ? parsed.welcomedUsers : [],
      stats: {
        ...defaultData().stats,
        ...(parsed.stats || {}),
      },
    };
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addSubscriber(userId) {
  const data = loadData();
  if (!data.subscribers.includes(userId)) {
    data.subscribers.push(userId);
    saveData(data);
    return true;
  }
  return false;
}

function removeSubscriber(userId) {
  const data = loadData();
  const before = data.subscribers.length;
  data.subscribers = data.subscribers.filter(id => id !== userId);
  saveData(data);
  return data.subscribers.length !== before;
}

function getSubscriberCount() {
  return loadData().subscribers.length;
}

function markWelcomed(userId) {
  const data = loadData();
  if (!data.welcomedUsers.includes(userId)) {
    data.welcomedUsers.push(userId);
    saveData(data);
  }
}

function hasBeenWelcomed(userId) {
  return loadData().welcomedUsers.includes(userId);
}

function incrementStats(patch) {
  const data = loadData();
  data.stats = {
    ...data.stats,
    ...Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [
        key,
        typeof value === 'number' ? (data.stats[key] || 0) + value : value,
      ])
    ),
  };
  saveData(data);
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

function buildWelcomeEmbed(member) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`Welcome to ${BRAND_NAME}`)
    .setDescription(
      `Welcome ${member}.\n\nJoin **5000+ traders** getting:\n\n• Promo codes\n• Limited-time discounts\n• Competitions & giveaways\n• Important updates\n\n⚡ Click below to get direct alerts.`
    )
    .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
    .setTimestamp();
}

async function addReactions(message, reactions) {
  for (const emoji of reactions) {
    try {
      await message.react(emoji);
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.log(`Failed to react with ${emoji}: ${error.message}`);
    }
  }
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
      option
        .setName('active_promotions')
        .setDescription('Post in #active-promotions')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('ping_everyone')
        .setDescription('Ping @everyone in selected channels')
        .setRequired(false)
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
      option
        .setName('active_promotions')
        .setDescription('Post in #active-promotions')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('ping_everyone')
        .setDescription('Ping @everyone in selected channels')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

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
