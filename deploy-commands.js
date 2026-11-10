require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
const { RARITIES } = require('./wallahiCatalog');

const rarityChoices = Object.entries(RARITIES).map(([value, rarity]) => ({
  name: rarity.name,
  value,
}));

const commands = [
  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give an amount of Wallahis to a player')
    .addUserOption((option) =>
      option.setName('user').setDescription('Player to give Wallahis to').setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('quantity')
        .setDescription('Amount of Wallahis to give')
        .setMinValue(1)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove all Wallahis from a player')
    .addUserOption((option) =>
      option.setName('user').setDescription('Player to remove Wallahis from').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Check your XP towards the next Wallahi level'),
  new SlashCommandBuilder()
    .setName('wallahis')
    .setDescription('Wallahis commands')
    .addSubcommand((subcommand) =>
      subcommand.setName('left').setDescription('See how many Wallahis you have left')
    ),
  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Set Wallahi stats for a player')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('xp')
        .setDescription("Set a player's XP for their current Wallahi level")
        .addUserOption((option) =>
          option.setName('user').setDescription('Player to set XP for').setRequired(true)
        )
        .addNumberOption((option) =>
          option.setName('amount').setDescription('XP amount to set').setMinValue(0).setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('level')
        .setDescription("Set a player's Wallahi level")
        .addUserOption((option) =>
          option.setName('user').setDescription('Player to set level for').setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('Wallahi level to set')
            .setMinValue(0)
            .setMaxValue(100)
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a permanent bonus to a player')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('boost')
        .setDescription('Set an additional permanent XP boost for a player')
        .addUserOption((option) =>
          option.setName('user').setDescription('Player to boost').setRequired(true)
        )
        .addNumberOption((option) =>
          option
            .setName('amount')
            .setDescription('Boost percentage; use 0 to remove it')
            .setMinValue(0)
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 5 players with the most Wallahis'),
  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('View a CATCH WALLAHIS collection')
    .addUserOption((option) =>
      option.setName('user').setDescription("Player whose collection you'd like to view")
    ),
  new SlashCommandBuilder()
    .setName('minigame')
    .setDescription('Configure the CATCH WALLAHIS minigame')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('channel')
        .setDescription('Set the channel where the bot will send the Wallahis for the minigame')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Wallahi spawn channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('active').setDescription('Activate CATCH WALLAHIS in this server')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('disable').setDescription('Disable CATCH WALLAHIS in this server')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Show the CATCH WALLAHIS configuration')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('spawn')
        .setDescription('Force a Wallahi spawn for testing')
        .addStringOption((option) =>
          option
            .setName('rarity')
            .setDescription('Force a rarity')
            .addChoices(...rarityChoices)
        )
        .addStringOption((option) =>
          option
            .setName('wallahi')
            .setDescription('Force a specific Wallahi')
            .setAutocomplete(true)
        )
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  try {
    const guildsToClear = new Set(
      [process.env.GUILD_ID, process.env.TEST_GUILD_ID].filter(Boolean)
    );
    for (const guildId of guildsToClear) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: [] });
    }
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Global slash commands registered successfully.');
  } catch (error) {
    console.error('Error while registering commands:', error);
    process.exitCode = 1;
  }
}

if (require.main === module) deployCommands();

module.exports = { commands, deployCommands };
