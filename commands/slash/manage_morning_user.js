import { SlashCommandBuilder } from 'discord.js';
import MorningGreeting from '../../models/MorningGreeting.js';
import { sendGreetingToUser } from '../../utils/morningGreeting.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('manage_morning_user')
        .setDescription('Quản lý danh sách người dùng nhận tin nhắn chào buổi sáng (Bot Admin Only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Người dùng cần thêm/xóa/test')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Hành động')
                .setRequired(true)
                .addChoices(
                    { name: 'Thêm', value: 'add' },
                    { name: 'Xóa', value: 'remove' },
                    { name: 'Test', value: 'test' }
                )),

    async execute(interaction) {
        // Kiểm tra quyền Bot Admin
        const botAdminId = '1149477475001323540';
        if (interaction.user.id !== botAdminId) {
            return interaction.reply({ content: t('errors.no_permission'), ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const action = interaction.options.getString('action');

        try {
            if (action === 'add') {
                const existing = await MorningGreeting.findOne({ userId: targetUser.id });
                if (existing) {
                    return interaction.reply({ content: t('general.morning.user_exists', { username: targetUser.username }), ephemeral: true });
                }

                await MorningGreeting.create({
                    userId: targetUser.id,
                    userName: targetUser.username,
                    addedBy: interaction.user.id
                });

                return interaction.reply(t('general.morning.user_added', { username: targetUser.username }));
            }

            else if (action === 'remove') {
                const result = await MorningGreeting.findOneAndDelete({ userId: targetUser.id });
                if (!result) {
                    return interaction.reply({ content: t('general.morning.user_not_found', { username: targetUser.username }), ephemeral: true });
                }

                return interaction.reply(t('general.morning.user_removed', { username: targetUser.username }));
            }

            else if (action === 'test') {
                await interaction.deferReply({ ephemeral: true });

                try {
                    const result = await sendGreetingToUser(interaction.client, targetUser.id);
                    return interaction.editReply(t('general.morning.test_success', { username: result.username, content: result.content }));
                } catch (err) {
                    return interaction.editReply(t('general.morning.test_failed', { username: targetUser.username, error: err.message }));
                }
            }

        } catch (error) {
            console.error('Error in manage_morning_user:', error);
            return interaction.reply({ content: t('errors.database_error'), ephemeral: true });
        }
    },
};
