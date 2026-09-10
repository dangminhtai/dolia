import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import RadioSong from '../../models/RadioSong.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('radio-remove247')
        .setDescription('Xóa bài hát khỏi kho nhạc Radio 24/7')
        .addIntegerOption(o => o.setName('index').setDescription('Số thứ tự bài hát (Xem trong /radio-list247)').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Chỉ Admin được xóa

    async execute(interaction) {
        await interaction.deferReply();
        const index = interaction.options.getInteger('index');

        // 1. Lấy tất cả bài hát để tìm bài ở vị trí index
        // (Cách này hơi thủ công nhưng chính xác nhất với cái list người dùng nhìn thấy)
        const songs = await RadioSong.find();

        if (index < 1 || index > songs.length) {
            return interaction.editReply(t('music.errors.index_out_of_range_simple', { max: songs.length }));
        }

        // Lấy bài hát cần xóa (Mảng bắt đầu từ 0 nên phải trừ 1)
        const songToDelete = songs[index - 1];

        // 2. Xóa khỏi DB
        await RadioSong.findByIdAndDelete(songToDelete._id);

        return interaction.editReply(t('music.radio.removed_indexed', { index, title: songToDelete.title }));
    },
};