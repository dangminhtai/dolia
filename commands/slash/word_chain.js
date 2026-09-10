import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { t } from '../../services/i18nService.js';

const activeGames = new Map();

export default {
    data: new SlashCommandBuilder()
        .setName('word_chain')
        .setDescription('Bắt đầu trò chơi nối từ tiếng Việt')
        .addStringOption(option => option.setName('word').setDescription('Từ đầu tiên để bắt đầu').setRequired(true)),
    async execute(interaction) {
        try {
            const word = interaction.options.getString('word').toLowerCase().trim();
            const channelId = interaction.channelId;

            if (word.split(' ').length < 2) {
                return interaction.reply({ content: t('word_chain.invalid_format'), ephemeral: true });
            }

            activeGames.set(channelId, {
                lastWord: word,
                lastChar: word.split(' ').pop(),
                players: new Set([interaction.user.id]),
                combo: 1
            });

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(t('word_chain.title'))
                .setDescription(t('word_chain.started', { word }))
                .setFooter({ text: t('word_chain.footer') });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('WordChain Error:', error);
            await interaction.reply({ content: t('word_chain.error'), ephemeral: true });
        }
    }
};