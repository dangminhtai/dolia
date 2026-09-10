import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { setConfig } from "../../utils/childConfigUtils.js";
import { t } from "../../services/i18nService.js";

export default {
    data: new SlashCommandBuilder()
        .setName('stop-slash-deploy')
        .setDescription('Bật/Tắt bot trên môi trường Deploy (Linux)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption(option =>
            option.setName('status')
                .setDescription('True để chặn Linux, False để cho phép')
                .setRequired(true)),
    async execute(interaction) {
        const status = interaction.options.getBoolean('status');

        // Cập nhật vào Database (ChildBotConfig)
        await setConfig('stop_deploy', status);

        const statusText = status ? t('common.status_on') : t('common.status_off');
        await interaction.reply({
            content: t('common.deploy_blocked', {
                status: statusText,
                action: status ? t('common.action_blocked') : t('common.action_normal')
            }),
            ephemeral: true
        });
    },
};
