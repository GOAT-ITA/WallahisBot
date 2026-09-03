require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give an amount of wallahis to a player')
    .addUserOption((option) =>
      option.setName('user').setDescription('Player to give wallahis to').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('Amount of wallahis to give').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove all wallahis of a player')
    .addUserOption((option) =>
      option.setName('user').setDescription('Player to remove wallahis from').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Check how much xp you have towards your next wallahi level'),

  new SlashCommandBuilder()
    .setName('wallahis')
    .setDescription('Wallahis commands')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('left')
        .setDescription('See how many wallahis you have left')
    ),

  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Set wallahi stats for a player')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('xp')
        .setDescription('Set a player xp for their current wallahi level')
        .addUserOption((option) =>
          option.setName('user').setDescription('Player to set xp for').setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('XP amount to set')
            .setMinValue(0)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('level')
        .setDescription('Set a player wallahi level')
        .addUserOption((option) =>
          option.setName('user').setDescription('Player to set level for').setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('Wallahi level to set')
            .setMinValue(0)
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show top 5 players with most wallahis in the server'),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    // Clear the old guild-specific commands from the original server, if a GUILD_ID is set,
    // so they don't show up twice alongside the new global ones.
    if (process.env.GUILD_ID) {
      console.log('Clearing old guild-specific commands from the original server...');
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: [] }
      );
    }

    console.log('Registering global slash commands (works on every server the bot is in)...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('Slash commands registered successfully! They can take up to an hour to appear on all servers (usually much faster).');
  } catch (error) {
    console.error('Error while registering commands:', error);
  }
})();
