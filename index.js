require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
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

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { lastVideoId: null };
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { lastVideoId: null };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getYoutubeThumbnail(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

const commands = [
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a branded announcement')
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
    .setTitle('🎥 New Video Just Dropped')
    .setURL(video.link)
    .setDescription(
      `**${video.title}**\n\nA new video has just been uploaded to the **${BRAND_NAME}** YouTube channel.\n\n[Watch now →](${video.link})`
    )
    .setThumbnail(LOGO_URL)
    .setImage(video.thumbnail)
    .setFooter({ text: YT_FOOTER, iconURL: LOGO_URL })
    .setTimestamp();

  await channel.send({
    content: '@everyone',
    embeds: [embed],
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

client.once('clientReady', async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  await checkYoutubeFeed();
  setInterval(checkYoutubeFeed, 5 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
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
    });
  }

  if (interaction.commandName === 'testyt') {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setAuthor({
        name: `${BRAND_NAME} YouTube`,
        iconURL: LOGO_URL,
      })
      .setTitle('🎥 New Video Just Dropped')
      .setURL('https://youtube.com')
      .setDescription(
        `**This is a branded test video**\n\nA new video has just been uploaded to the **${BRAND_NAME}** YouTube channel.\n\n[Watch now →](https://youtube.com)`
      )
      .setThumbnail(LOGO_URL)
      .setImage('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')
      .setFooter({ text: YT_FOOTER, iconURL: LOGO_URL })
      .setTimestamp();

    await interaction.reply({
      content: 'Test YouTube alert:',
      embeds: [embed],
    });
  }
});

(async () => {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})()
