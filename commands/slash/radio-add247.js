import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import RadioSong from '../../models/RadioSong.js';

export default {
    data: new SlashCommandBuilder()
        .setName('radio-add247')
        .setDescription('Thêm bài hát vào kho nhạc 24/7')
        .addStringOption(o => o.setName('query').setDescription('Link bài hát hoặc tên').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Chỉ Admin được dùng

    async execute(interaction) {
        await interaction.deferReply();
        const query = interaction.options.getString('query');

        // Dùng Poru để check xem bài hát có tồn tại không và lấy tên chuẩn
        const res = await poru.resolve({ query: query, source: 'ytsearch', requester: interaction.user });

        if (res.loadType === 'LOAD_FAILED' || res.loadType === 'NO_MATCHES') {
            return interaction.editReply('❌ Không tìm thấy bài hát này!');
        }

        const track = res.tracks[0];

        // Lưu vào MongoDB
        await RadioSong.create({
            url: track.info.uri,
            title: track.info.title,
            addedBy: interaction.user.tag
        });

        return interaction.editReply(`✅ Đã thêm **${track.info.title}** vào kho nhạc Radio!`);
    },
};