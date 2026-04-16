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
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

async function postYoutubeVideo(video) {
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);

  if (!channel) {
    console.error('Discord channel not found.');
    return;
  }

  const embed = buildYoutubeEmbed(video);

  const msg = await channel.send({
    embeds: [embed],
    components: [buildWebsiteButtonRow()],
  });

  await addReactions(msg, YT_REACTIONS);
}

async function checkYoutubeFeed() {
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${process.env.YOUTUBE_CHANNEL_ID}`;
    const feed = await parser.parseURL(feedUrl);

    if (!feed.items || feed.items.length === 0) {
      return;
    }

    const latest = feed.items[0];
    const videoId = latest.id?.split(':').pop();

    if (!AUTO_POST_SHORTS && looksLikeShort(latest)) {
      console.log('Latest upload looks like a Short. Skipping auto-post.');
      return;
    }

    const data = loadData();

    if (!data.lastVideoId) {
      data.lastVideoId = videoId;
      saveData(data);
      console.log('Initial YouTube video saved, no alert sent.');
      return;
    }

    if (data.lastVideoId !== videoId) {
      await postYoutubeVideo({
        title: latest.title,
        link: latest.link,
        thumbnail: getYoutubeThumbnail(videoId),
      });

      data.lastVideoId = videoId;
      saveData(data);

      console.log('New YouTube video posted.');
    }
  } catch (error) {
    console.error('YouTube check failed:', error.message);
  }
}

async function sendEmbedToSubscribers(embed) {
  const data = loadData();
  const subscribers = data.subscribers || [];

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
    } catch (error) {
      failCount += 1;
      console.log(`Failed DM to ${userId}: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  incrementStats({
    totalDmSent: successCount,
    totalDmFailed: failCount,
  });

  return {
    total: subscribers.length,
    successCount,
    failCount,
  };
}

async function sendEmbedToSelectedChannels(embed, options) {
  const channelTargets = [
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

  let postedCount = 0;
  let failedCount = 0;

  for (const target of channelTargets) {
    if (!target.enabled) continue;
    if (!target.id) {
      failedCount += 1;
      console.log(`Missing channel ID for ${target.label}`);
      continue;
    }

    try {
      const channel = await client.channels.fetch(target.id);

      if (!channel || channel.type !== ChannelType.GuildText) {
        failedCount += 1;
        console.log(`Channel not found or not text for ${target.label}`);
        continue;
      }

      const msg = await channel.send({
        content: options.pingEveryone ? '@everyone' : '',
        embeds: [embed],
        components: [buildWebsiteButtonRow()],
      });

      await addReactions(msg, ANNOUNCE_REACTIONS);
      postedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.log(`Failed to post in ${target.label}: ${error.message}`);
    }
  }

  incrementStats({
    totalChannelPosts: postedCount,
    totalChannelFailures: failedCount,
  });

  return { postedCount, failedCount };
}

async function runBroadcast({
  embed,
  sendDM,
  general,
  announcements,
  activePromotions,
  pingEveryone,
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
  });

  incrementStats({
    totalAlertsRun: 1,
    lastAlertAt: new Date().toISOString(),
  });

  return { dmResult, channelResult };
}

async function sendWelcomeFlow(member) {
  if (hasBeenWelcomed(member.id)) {
    return;
  }

  const embed = buildWelcomeEmbed(member);
  const components = [buildSubscriptionButtons(), buildWebsiteButtonRow()];

  try {
    const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
    if (welcomeChannelId) {
      const channel = await client.channels.fetch(welcomeChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({
          content: `${member}`,
          embeds: [embed],
          components,
        });
        incrementStats({ totalWelcomePosts: 1 });
      }
    }
  } catch (error) {
    console.log(`Failed welcome channel post for ${member.id}: ${error.message}`);
  }

  try {
    await member.send({
      embeds: [embed],
      components,
    });
    incrementStats({ totalWelcomeDMs: 1 });
  } catch (error) {
    console.log(`Failed welcome DM for ${member.id}: ${error.message}`);
  }

  markWelcomed(member.id);
}

client.once('clientReady', async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  await checkYoutubeFeed();
  setInterval(checkYoutubeFeed, 5 * 60 * 1000);
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
      const added = addSubscriber(userId);

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
            .setTitle('🚀 Welcome to TTT Early Access')
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
      const removed = removeSubscriber(userId);

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
    const postActivePromotions =
      interaction.options.getBoolean('active_promotions') || false;
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
    const data = loadData();
    const count = data.subscribers.length;
    const stats = data.stats;

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
    const subscribers = loadData().subscribers || [];
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
    const added = addSubscriber(user.id);

    if (added) {
      incrementStats({ totalManualAdds: 1 });
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
    const removed = removeSubscriber(user.id);

    if (removed) {
      incrementStats({ totalManualRemoves: 1 });
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
    const postActivePromotions =
      interaction.options.getBoolean('active_promotions') || false;
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

(async () => {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();
