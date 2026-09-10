import { SlashCommandBuilder, ChannelType } from 'discord.js'; // Nhớ import ChannelType
import { poru } from '../../utils/LavalinkManager.js';
import { applyAudioSettings } from '../../utils/AudioController.js';
import GuildMusicQueue from '../../models/GuildMusicQueue.js';
import User from '../../models/User.js';

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
        const member = interaction.member;

        // --- LOGIC CHỌN KÊNH VOICE THÔNG MINH ---
        let voiceChannel = member.voice.channel;
        let player = poru.players.get(interaction.guild.id);

        // Trường hợp 1: Người dùng KHÔNG ở trong voice
        if (!voiceChannel) {
            if (player && player.isConnected) {
                // Nếu Bot đang hát ở đâu đó -> Dùng luôn kênh đó (Điều khiển từ xa)
                voiceChannel = interaction.guild.channels.cache.get(player.voiceChannel);
            } else {
                // Nếu Bot chưa hát -> Tự động tìm kênh Voice đầu tiên của Server để chui vào
                // (Lọc ra kênh Voice, không lấy kênh Stage, và bot phải vào được)
                voiceChannel = interaction.guild.channels.cache
                    .filter(c => c.type === ChannelType.GuildVoice && c.joinable && !c.full)
                    .first();
            }
        }

        // Nếu tìm mọi cách mà vẫn không ra kênh voice nào (Server không tạo kênh Voice?)
        if (!voiceChannel) {
            return interaction.editReply('❌ Bot không tìm thấy kênh Voice nào để vào cả!');
        }
        // ------------------------------------------

        // 1. Tạo hoặc lấy kết nối (Nếu chưa có player)
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
        // Auto-detect URL or Search
        const isUrl = /^https?:\/\//.test(query);
        let res;
        try {
            // Logic tự nhận diện URL như lúc nãy đã bàn
            // Logic tự nhận diện URL như lúc nãy đã bàn
            let source = 'ytsearch';
            if (!isUrl) {
                const userConfig = await User.findOne({ userId: interaction.user.id });
                if (userConfig && userConfig.musicProvider) {
                    source = userConfig.musicProvider;
                }
            }
            res = await poru.resolve({ query: query, source: isUrl ? null : source, requester: interaction.user });
        } catch (error) {
            console.error('Lavalink Resolve Error:', error);
            return interaction.editReply('❌ Lỗi kết nối Node nhạc (Bad Gateway).');
        }

        if (!res || res.loadType === 'LOAD_FAILED') {
            return interaction.editReply('❌ Lỗi tải nhạc.');
        } else if (res.loadType === 'NO_MATCHES') {
            return interaction.editReply('❌ Không tìm thấy bài nào!');
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

        if (res.loadType === 'PLAYLIST_LOADED') {
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
                msg = `⚡ **[ƯU TIÊN]** Đã chèn Playlist **${res.playlistInfo.name}** lên đầu!`;
            } else {
                player.queue.add(res.tracks);
                msg = `✅ Đã thêm Playlist **${res.playlistInfo.name}** vào hàng chờ.`;
            }
        }
        else {
            const track = res.tracks[0];
            track.info.requester = interaction.user;
            tracksToAdd.push(formatTrackForDB(track));

            if (isPriority) {
                player.queue.unshift(track);
                msg = `⚡ **[ƯU TIÊN]** Đã chèn **${track.info.title}** lên đầu!`;
            } else {
                player.queue.add(track);
                if (player.isPlaying || player.isPaused) {
                    msg = `✅ Đã thêm vào hàng chờ: **${track.info.title}**`;
                } else {
                    msg = `▶️ Đang phát: **${track.info.title}** tại kênh **${voiceChannel.name}**`;
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