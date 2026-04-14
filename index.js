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
} = require('discord.js');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const parser = new Parser();

const BRAND_COLOR = 0xf35023;
const BRAND_NAME = 'TTT Markets';
const BRAND_FOOTER = 'TTT Markets • Official Alerts';
const YT_FOOTER = 'TTT Markets • YouTube Alerts';
const LOGO_URL = 'https://tttmarkets.com/wp-content/uploads/2025/09/cropped-TTT-Logo.png';
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://tttmarkets.com';

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { lastVideoId: null, subscribers: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      lastVideoId: parsed.lastVideoId || null,
      subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
    };
  } catch {
    return { lastVideoId: null, subscribers: [] };
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

function getYoutubeThumbnail(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
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
      .setLabel('Get Promo Alerts')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('unsubscribe_alerts')
      .setLabel('Stop Alerts')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildAlertEmbed({ title, message, image }) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({
      name: BRAND_NAME,
      iconURL: LOGO_URL,
    })
    .setTitle(title)
    .setDescription(message)
    .setThumbnail(LOGO_URL)
    .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
    .setTimestamp();

  if (image) {
    embed.setImage(image);
  }

  return embed;
}

const commands = [
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a branded announcement in the server')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Announcement title')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Announcement message')
        .setRequired(true)
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
    .setName('sendalert')
    .setDescription('Send an alert to subscribers and/or selected channels')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Alert title')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Alert body')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('image')
        .setDescription('Image URL (optional)')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('send_dm')
        .setDescription('Send DM to subscribed users')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('general')
        .setDescription('Post in #general')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('announcements')
        .setDescription('Post in #announcements')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('active_promotions')
        .setDescription('Post in #active-promotions')
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

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({
      name: `${BRAND_NAME} YouTube`,
      iconURL: LOGO_URL,
    })
    .setTitle('📊 New Trading Breakdown')
    .setURL(video.link)
    .setDescription(
      `**${video.title}**\n\nA new breakdown has just been released by **${BRAND_NAME}**.\n\n📈 Insights. Execution. Strategy.\n\n🔥 [Watch the full video →](${video.link})`
    )
    .setThumbnail(LOGO_URL)
    .setImage(video.thumbnail)
    .setFooter({ text: YT_FOOTER, iconURL: LOGO_URL })
    .setTimestamp();

  await channel.send({
    embeds: [embed],
    components: [buildWebsiteButtonRow()],
  });
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

async function sendAlertToSubscribers(embed) {
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

  return {
    total: subscribers.length,
    successCount,
    failCount,
  };
}

async function sendAlertToSelectedChannels(embed, options) {
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

      if (!channel) {
        failedCount += 1;
        console.log(`Channel not found for ${target.label}`);
        continue;
      }

      await channel.send({
        content: '@everyone',
        embeds: [embed],
        components: [buildWebsiteButtonRow()],
      });

      postedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.log(`Failed to post in ${target.label}: ${error.message}`);
    }
  }

  return { postedCount, failedCount };
}

client.once('clientReady', async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  await checkYoutubeFeed();
  setInterval(checkYoutubeFeed, 5 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const userId = interaction.user.id;

    if (interaction.customId === 'subscribe_alerts') {
      const added = addSubscriber(userId);

      await interaction.reply({
        content: added
          ? '✅ You are now subscribed to TTT promo alerts by DM.'
          : 'ℹ️ You are already subscribed to TTT promo alerts.',
        ephemeral: true,
      });
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

    const embed = buildAlertEmbed({ title, message });

    await interaction.reply({
      embeds: [embed],
      components: [buildWebsiteButtonRow()],
    });
    return;
  }

  if (interaction.commandName === 'testyt') {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({
        name: `${BRAND_NAME} YouTube`,
        iconURL: LOGO_URL,
      })
      .setTitle('📊 New Trading Breakdown')
      .setURL('https://youtube.com')
      .setDescription(
        `**This is a branded test video**\n\nA new breakdown has just been released by **${BRAND_NAME}**.\n\n📈 Insights. Execution. Strategy.\n\n🔥 [Watch the full video →](https://youtube.com)`
      )
      .setThumbnail(LOGO_URL)
      .setImage('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')
      .setFooter({ text: YT_FOOTER, iconURL: LOGO_URL })
      .setTimestamp();

    await interaction.reply({
      content: 'Test YouTube alert:',
      embeds: [embed],
      components: [buildWebsiteButtonRow()],
    });
    return;
  }

  if (interaction.commandName === 'setupalerts') {
    const count = getSubscriberCount();

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({
        name: BRAND_NAME,
        iconURL: LOGO_URL,
      })
      .setTitle('🔔 TTT Promo Alerts')
      .setDescription(
        `Join **${count}+ traders** getting:\n\n• Promo codes\n• Competitions\n• Important updates\n\n⚡ Be first to know before they go live.`
      )
      .setThumbnail(LOGO_URL)
      .setFooter({ text: BRAND_FOOTER, iconURL: LOGO_URL })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      components: [buildSubscriptionButtons(), buildWebsiteButtonRow()],
    });
    return;
  }

  if (interaction.commandName === 'subscriberstats') {
    const count = getSubscriberCount();

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({
        name: BRAND_NAME,
        iconURL: LOGO_URL,
      })
      .setTitle('Subscriber Stats')
      .setDescription(`Current subscribed users: **${count}**`)
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

  if (interaction.commandName === 'sendalert') {
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const image = interaction.options.getString('image');
    const sendDM = interaction.options.getBoolean('send_dm', true);
    const postGeneral = interaction.options.getBoolean('general') || false;
    const postAnnouncements = interaction.options.getBoolean('announcements') || false;
    const postActivePromotions = interaction.options.getBoolean('active_promotions') || false;

    await interaction.reply({
      content: 'Sending alert...',
      ephemeral: true,
    });

    const embed = buildAlertEmbed({
      title,
      message,
      image,
    });

    let dmResult = {
      total: 0,
      successCount: 0,
      failCount: 0,
    };

    if (sendDM) {
      dmResult = await sendAlertToSubscribers(embed);
    }

    const channelResult = await sendAlertToSelectedChannels(embed, {
      general: postGeneral,
      announcements: postAnnouncements,
      activePromotions: postActivePromotions,
    });

    await interaction.followUp({
      content:
        `Alert complete.\n\n` +
        `DM Subscribers: ${dmResult.total}\n` +
        `DM Sent: ${dmResult.successCount}\n` +
        `DM Failed: ${dmResult.failCount}\n` +
        `Channel Posts: ${channelResult.postedCount}\n` +
        `Channel Failures: ${channelResult.failedCount}`,
      ephemeral: true,
    });
    return;
  }
});

(async () => {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();
