import { t as tr } from '../../services/i18nService.js';
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import RadioSong from '../../models/RadioSong.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('radio-list247')
        .setDescription(tr('commands.radio_list247.setdescription_xem_danh_sach_nhac_trong_kho_radio'))
        .addIntegerOption(o => o.setName('page').setDescription(tr('commands.radio_list247.setdescription_so_trang_muon_xem')).setMinValue(1)),

    async execute(interaction) {
        await interaction.deferReply();

        // 1. Cấu hình phân trang
        const itemsPerPage = 10;
        const page = interaction.options.getInteger('page') || 1;

        // 2. Lấy dữ liệu từ DB
        const totalSongs = await RadioSong.countDocuments();
        const songs = await RadioSong.find()
            .skip((page - 1) * itemsPerPage) // Bỏ qua các bài của trang trước
            .limit(itemsPerPage); // Chỉ lấy 10 bài

        // Check nếu kho trống
        if (totalSongs === 0) {
            return interaction.editReply(t('music.radio.empty_list'));
        }

        const totalPages = Math.ceil(totalSongs / itemsPerPage);

        // Check nếu nhập trang tào lao
        if (page > totalPages) {
            return interaction.editReply(t('music.radio.invalid_page', { totalPages }));
        }

        // 3. Tạo danh sách hiển thị
        // Tính số thứ tự bắt đầu (VD: Trang 2 bắt đầu từ số 11)
        const startRank = (page - 1) * itemsPerPage + 1;

        const description = songs.map((song, index) => {
            return tr('messages.music.radio_list_item', { rank: startRank + index, title: song.title, url: song.url, addedBy: song.addedBy || tr('messages.music.radio_added_by') });
        }).join('\n');

        // 4. Tạo Embed đẹp
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(t('music.radio.list_title', { total: totalSongs }))
            .setDescription(description)
            .setFooter({ text: t('music.radio.list_footer', { page, totalPages }) });

        return interaction.editReply({ embeds: [embed] });
    },
};