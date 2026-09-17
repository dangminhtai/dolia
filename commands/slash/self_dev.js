import { t as tr } from '../../services/i18nService.js';
import { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } from 'discord.js';
import { SelfDevService } from '../../services/selfDevService.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('self-dev')
        .setDescription(tr('commands.self_dev.setdescription_yeu_cau_dolia_tu_lap_trinh_tinh'))
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription(tr('commands.self_dev.setdescription_mo_ta_tinh_nang_tro_choi_hoac'))
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('feature_name')
                .setDescription(tr('commands.self_dev.setdescription_ten_lenh_goi_y_viet_thuong_khong'))
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!SelfDevService.isOwner(interaction.user.id)) {
            return interaction.reply({
                content: t('self_dev.only_owner'),
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const prompt = interaction.options.getString('prompt');
        const featureName = interaction.options.getString('feature_name');

        await SelfDevService.startSession({
            prompt,
            featureName,
            user: interaction.user,
            channel: interaction.channel,
            client: interaction.client,
            replyTarget: interaction
        });
    }
};
