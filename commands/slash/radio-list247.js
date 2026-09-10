import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import RadioSong from '../../models/RadioSong.js';

export default {
    data: new SlashCommandBuilder()
        .setName('radio-list247')
        .setDescription('Xem danh sách nhạc trong kho Radio 24/7')
        .addIntegerOption(o => o.setName('page').setDescription('Số trang muốn xem').setMinValue(1)),

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
            return interaction.editReply('❌ Kho nhạc đang trống trơn! Dùng `/radio-add` thêm vào đi.');
        }

        const totalPages = Math.ceil(totalSongs / itemsPerPage);

        // Check nếu nhập trang tào lao
        if (page > totalPages) {
            return interaction.editReply(`❌ Chỉ có tổng cộng **${totalPages}** trang thôi ông ơi.`);
        }

        // 3. Tạo danh sách hiển thị
        // Tính số thứ tự bắt đầu (VD: Trang 2 bắt đầu từ số 11)
        const startRank = (page - 1) * itemsPerPage + 1;

        const description = songs.map((song, index) => {
            return `**${startRank + index}.** [${song.title}](${song.url}) - *${song.addedBy || 'Admin'}*`;
        }).join('\n');

        // 4. Tạo Embed đẹp
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`📻 KHO NHẠC RADIO 24/7 (Tổng: ${totalSongs} bài)`)
            .setDescription(description)
            .setFooter({ text: `Trang ${page}/${totalPages} • Dùng /radio-remove [số thứ tự] để xóa` });

        return interaction.editReply({ embeds: [embed] });
    },
};