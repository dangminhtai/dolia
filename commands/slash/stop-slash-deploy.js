
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { setConfig } from "../../utils/childConfigUtils.js";

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

        const statusText = status ? 'ĐÃ BẬT 🔴' : 'ĐÃ TẮT 🟢';
        await interaction.reply({
            content: `[Child Bot] Chế độ chặn Deploy (Linux): ${statusText}.\nTừ giờ bot Linux sẽ ${status ? 'không phản hồi' : 'phản hồi bình thường'}.`,
            ephemeral: true
        });
    },
};
