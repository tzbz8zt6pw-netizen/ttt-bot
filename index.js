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
    .setName('sendpromo')
    .setDescription('Send a promo DM to all subscribed users')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Promo title')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Promo body')
        .setRequired(true)
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

async function notifySubscribersPromo(title, message) {
  const data = loadData();
  const subscribers = data.subscribers || [];

  let successCount = 0;
  let failCount = 0;

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

  const components = [buildWebsiteButtonRow()];

  for (const userId of subscribers) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [embed],
        components,
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
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({
        name: BRAND_NAME,
        iconURL: LOGO_URL,
      })
      .setTitle('🔔 TTT Promo Alerts')
      .setDescription(
        `Get **promotions, competitions, and important updates** directly by DM.\n\nClick below to manage your alerts.`
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

  if (interaction.commandName === 'sendpromo') {
    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);

    await interaction.reply({
      content: 'Sending promo DM to subscribed users...',
      ephemeral: true,
    });

    const result = await notifySubscribersPromo(title, message);

    await interaction.followUp({
      content:
        `Promo send complete.\n` +
        `Subscribers: ${result.total}\n` +
        `Sent: ${result.successCount}\n` +
        `Failed: ${result.failCount}`,
      ephemeral: true,
    });
    return;
  }
});

(async () => {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();
