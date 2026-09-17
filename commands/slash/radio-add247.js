import { t as tr } from '../../services/i18nService.js';
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import RadioSong from '../../models/RadioSong.js';
import { t } from '../../services/i18nService.js';
import { isSuccess } from '../../utils/lavalinkHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('radio-add247')
        .setDescription(tr('commands.radio_add247.setdescription_them_bai_hat_vao_kho_nhac_24'))
        .addStringOption(o => o.setName('query').setDescription(tr('commands.radio_add247.setdescription_link_bai_hat_hoac_ten')).setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Chỉ Admin được dùng

    async execute(interaction) {
        await interaction.deferReply();
        const query = interaction.options.getString('query');
        const isUrl = /^https?:\/\//.test(query);

        // Dùng Poru để check xem bài hát có tồn tại không và lấy tên chuẩn
        const res = await poru.resolve({ query: query, source: isUrl ? null : 'ytsearch', requester: interaction.user });

        if (!isSuccess(res)) {
            return interaction.editReply(t('music.radio.track_not_found'));
        }

        const track = res.tracks[0];

        // Lưu vào MongoDB
        await RadioSong.create({
            url: track.info.uri,
            title: track.info.title,
            addedBy: interaction.user.tag
        });

        return interaction.editReply(t('music.radio.added', { title: track.info.title }));
    },
};