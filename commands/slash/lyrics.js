import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import GeminiLyrics from '../../class/GeminiLyrics.js';
import { sendSafeMessage } from '../../utils/messageHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Tìm kiếm lời bài hát bằng Dolia AI'),

    async execute(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('lyrics_modal')
            .setTitle('Dolia Lyrics Search');

        const queryInput = new TextInputBuilder()
            .setCustomId('lyrics_query_input')
            .setLabel("Nhập đoạn lời bài hát hoặc tên bài hát")
            .setPlaceholder('Ví dụ: "Em của ngày hôm qua" hoặc "đừng làm trái tim anh đau"...')
            .setStyle(TextInputStyle.Paragraph) // Sử dụng Paragraph để nhập được nhiều dòng
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(1000);

        const firstActionRow = new ActionRowBuilder().addComponents(queryInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
    }
};
