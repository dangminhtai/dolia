import { t as tr } from '../../services/i18nService.js';
import { SlashCommandBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import RadioSong from '../../models/RadioSong.js';
import { applyAudioSettings } from '../../utils/AudioController.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('play-247')
        .setDescription(tr('commands.play_247.setdescription_bat_che_do_radio_phat_nhac_ngau')),

    async execute(interaction) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: t('music.errors.no_voice_user'), ephemeral: true });
        }

        // Kiểm tra DB có bài nào chưa
        const count = await RadioSong.countDocuments();
        if (count === 0) {
            return interaction.reply({ content: t('music.radio.empty_list_prompt'), ephemeral: true });
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

        return interaction.editReply(t('music.radio.mode_enabled', { count, title: songData.title }));
    },
};