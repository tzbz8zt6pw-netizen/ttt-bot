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
const BRAND_FOOTER = 'TTT Announcement System';

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
    .setTitle('New YouTube Video')
    .setDescription(`**${video.title}**\n\n[Watch now](${video.link})`)
    .setURL(video.link)
    .setImage(video.thumbnail)
    .setFooter({ text: BRAND_FOOTER })
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
        thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
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
      .setTitle(title)
      .setDescription(message)
      .setFooter({ text: BRAND_FOOTER })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
    });
  }

  if (interaction.commandName === 'testyt') {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('New YouTube Video')
      .setDescription('**Test video title**\n\n[Watch now](https://youtube.com)')
      .setFooter({ text: BRAND_FOOTER })
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
})();