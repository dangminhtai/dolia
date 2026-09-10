import { SlashCommandBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import RadioSong from '../../models/RadioSong.js';
import { applyAudioSettings } from '../../utils/AudioController.js';
export default {
    data: new SlashCommandBuilder()
        .setName('play-247')
        .setDescription('Bật chế độ Radio phát nhạc ngẫu nhiên 24/7'),

    async execute(interaction) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Vui lòng vào voice trước khi sử dụng lệnh này!', ephemeral: true });
        }

        // Kiểm tra DB có bài nào chưa
        const count = await RadioSong.countDocuments();
        if (count === 0) {
            return interaction.reply({ content: '❌ Kho nhạc đang trống! Dùng `/radio-add` thêm bài trước đã.', ephemeral: true });
        }

        await interaction.deferReply();

        // Tạo kết nối (hoặc lấy kết nối cũ)
        let player = poru.players.get(interaction.guild.id);

        if (player) {
            // Nếu đang hát, xóa sạch hàng chờ cũ và dừng bài hiện tại
            player.queue.clear();
            player.stop();
        } else {
            // Tạo mới
            player = poru.createConnection({
                guildId: interaction.guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: interaction.channel.id,
                deaf: false,
            });
        }
        await applyAudioSettings(player);
        // --- KÍCH HOẠT CHẾ ĐỘ 24/7 ---
        player.isAutoplay = true;
        // -----------------------------

        // Lấy bài đầu tiên để "mồi"
        const randomSong = await RadioSong.aggregate([{ $sample: { size: 1 } }]);
        const songData = randomSong[0];

        const res = await poru.resolve({ query: songData.url, source: 'ytsearch', requester: interaction.user });
        const track = res.tracks[0];

        player.queue.add(track);
        player.play();

        return interaction.editReply(`📻 **Đã bật chế độ 24/7!**\nSẽ phát ngẫu nhiên từ kho nhạc (**${count}** bài).\n▶️ Mở bát bằng bài: **${songData.title}**`);
    },
};