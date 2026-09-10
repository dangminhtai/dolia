import { SlashCommandBuilder, ChannelType } from 'discord.js'; // Nhớ import ChannelType
import { poru } from '../../utils/LavalinkManager.js';
import { applyAudioSettings } from '../../utils/AudioController.js';
import GuildMusicQueue from '../../models/GuildMusicQueue.js';
import { t } from '../../services/i18nService.js';
import { getUserMusicSource, isFailed, isEmpty, isPlaylist, resolveWithProvider } from '../../utils/lavalinkHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Phát nhạc (Không cần bạn phải vào Voice)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Tên bài hát hoặc Link')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option.setName('priority')
                .setDescription('True = Chen ngang phát ngay lập tức')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const query = interaction.options.getString('query');
        const isPriority = interaction.options.getBoolean('priority') || false;

        // --- LOGIC CHỌN KÊNH VOICE THÔNG MINH ---
        const member = interaction.member;
        let voiceChannel = member.voice.channel;
        let player = poru.players.get(interaction.guild.id);

        if (!voiceChannel) {
            if (player && player.isConnected) {
                voiceChannel = interaction.guild.channels.cache.get(player.voiceChannel);
            } else {
                voiceChannel = interaction.guild.channels.cache
                    .filter(c => c.type === ChannelType.GuildVoice && c.joinable && !c.full)
                    .first();
            }
        }

        if (!voiceChannel) {
            return interaction.editReply(t('music.errors.no_voice_channel'));
        }

        if (!player) {
            player = poru.createConnection({
                guildId: interaction.guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: interaction.channel.id,
                deaf: false,
            });
            await applyAudioSettings(player);
        }

        // 2. Tìm nhạc
        let res;
        try {
            const resolveResult = await resolveWithProvider({
                poru,
                query,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                requester: interaction.user
            });
            res = resolveResult.res;
        } catch (error) {
            console.error('Lavalink Resolve Error:', error);
            return interaction.editReply(t('music.errors.bad_gateway'));
        }

        if (!res || isFailed(res.loadType)) {
            return interaction.editReply(t('music.errors.load_failed'));
        } else if (isEmpty(res.loadType, res.tracks)) {
            return interaction.editReply(t('music.errors.no_matches'));
        }

        // 3. Xử lý thêm nhạc & Lưu Database
        const tracksToAdd = [];
        let msg = '';

        // Hàm format data để lưu DB
        const formatTrackForDB = (track) => ({
            title: track.info.title,
            url: track.info.uri,
            author: track.info.author,
            duration: track.info.length,
            requester: interaction.user.tag,
            addedAt: new Date()
        });

        if (isPlaylist(res.loadType)) {
            // Logic mới: Chèn bài vào mảng tracksToAdd trước
            for (const track of res.tracks) {
                track.info.requester = interaction.user;
                tracksToAdd.push(formatTrackForDB(track));
            }

            if (isPriority) {
                // Priority: Unshift vào Queue (duyệt ngược)
                for (let i = res.tracks.length - 1; i >= 0; i--) {
                    player.queue.unshift(res.tracks[i]);
                }
                msg = t('music.play.priority_playlist_simple', { name: res.playlistInfo.name });
            } else {
                player.queue.add(res.tracks);
                msg = t('music.play.added_playlist_queue', { name: res.playlistInfo.name });
            }
        }
        else {
            const track = res.tracks[0];
            track.info.requester = interaction.user;
            tracksToAdd.push(formatTrackForDB(track));

            if (isPriority) {
                player.queue.unshift(track);
                msg = t('music.play.priority_track_simple', { title: track.info.title });
            } else {
                player.queue.add(track);
                if (player.isPlaying || player.isPaused) {
                    msg = t('music.play.added_to_queue_alt', { title: track.info.title });
                } else {
                    msg = t('music.play.now_playing_at', { title: track.info.title, channel: voiceChannel.name });
                }
            }
        }

        await interaction.editReply(msg);

        // 4. Lưu vào MongoDB
        // Logic Priority: Chèn đầu ($position: 0) nếu ưu tiên.
        // tracksToAdd đã được push đúng thứ tự.
        const updateQuery = isPriority
            ? { $push: { tracks: { $each: tracksToAdd, $position: 0 } } }
            : { $push: { tracks: { $each: tracksToAdd } } };

        GuildMusicQueue.updateOne(
            { guildId: interaction.guild.id },
            { ...updateQuery, $set: { updatedAt: new Date() } },
            { upsert: true }
        ).catch(e => console.error('Lỗi lưu Queue DB:', e));

        // 5. Kích hoạt phát nhạc
        if (isPriority) {
            if (player.isPlaying || player.isPaused) player.skip();
            else player.play();
        } else {
            if (!player.isPlaying && !player.isPaused) player.play();
        }
    },
};