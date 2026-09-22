import { SlashCommandBuilder } from 'discord.js';
import { t } from '../../services/i18nService.js';
import { renderMemoryPanel } from '../../services/memoryPanelService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('memory')
        .setDescription(t('memory.command.description')),
    async execute(interaction) {
        await interaction.reply({ ...(await renderMemoryPanel(interaction, 0)), ephemeral: true });
    }
};
