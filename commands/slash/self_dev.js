import { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } from 'discord.js';
import { SelfDevService } from '../../services/selfDevService.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('self-dev')
        .setDescription('Yêu cầu Dolia tự lập trình tính năng/lệnh mới (Chỉ dành cho Chủ nhân)')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Mô tả tính năng, trò chơi hoặc lệnh bạn muốn Dolia tự lập trình')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('feature_name')
                .setDescription('Tên lệnh gợi ý (viết thường không dấu, ví dụ: dice, coinflip, userinfo)')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!SelfDevService.isOwner(interaction.user.id)) {
            return interaction.reply({
                content: t('self_dev.only_owner') || 'Chỉ có chủ nhân của Dolia mới có quyền sử dụng tính năng này!',
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
