import { t as tr } from '../../services/i18nService.js';
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import RadioSong from '../../models/RadioSong.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('radio-remove247')
        .setDescription(tr('commands.radio_remove247.setdescription_xoa_bai_hat_khoi_kho_nhac_radio'))
        .addIntegerOption(o => o.setName('index').setDescription(tr('commands.radio_remove247.setdescription_so_thu_tu_bai_hat_xem_trong')).setRequired(true))
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