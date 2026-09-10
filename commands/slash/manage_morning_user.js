import { SlashCommandBuilder } from 'discord.js';
import MorningGreeting from '../../models/MorningGreeting.js';
import { sendGreetingToUser } from '../../utils/morningGreeting.js';

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
            return interaction.reply({ content: '❌ Bạn không có quyền sử dụng lệnh này. Chỉ Bot Admin mới có quyền quản lý.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const action = interaction.options.getString('action');

        try {
            if (action === 'add') {
                const existing = await MorningGreeting.findOne({ userId: targetUser.id });
                if (existing) {
                    return interaction.reply({ content: `Người dùng **${targetUser.username}** đã có trong danh sách rồi.`, ephemeral: true });
                }

                await MorningGreeting.create({
                    userId: targetUser.id,
                    userName: targetUser.username,
                    addedBy: interaction.user.id
                });

                return interaction.reply(`Thành công! Đã thêm **${targetUser.username}** vào danh sách chào buổi sáng.`);
            }

            else if (action === 'remove') {
                const result = await MorningGreeting.findOneAndDelete({ userId: targetUser.id });
                if (!result) {
                    return interaction.reply({ content: `Người dùng **${targetUser.username}** không có trong danh sách.`, ephemeral: true });
                }

                return interaction.reply(`Thành công! Đã xóa **${targetUser.username}** khỏi danh sách chào buổi sáng.`);
            }

            else if (action === 'test') {
                await interaction.deferReply({ ephemeral: true });

                try {
                    const result = await sendGreetingToUser(interaction.client, targetUser.id);
                    return interaction.editReply(`✅ Đã gửi tin nhắn test thành công cho **${result.username}**!\nNội dung: *"${result.content}"*`);
                } catch (err) {
                    return interaction.editReply(`❌ Không thể gửi tin nhắn cho **${targetUser.username}**. Có thể người dùng đã chặn DM hoặc bot gặp lỗi.\nChi tiết: \`${err.message}\``);
                }
            }

        } catch (error) {
            console.error('Error in manage_morning_user:', error);
            return interaction.reply({ content: 'Lỗi khi truy cập Database hoặc gửi tin nhắn, vui lòng kiểm tra log.', ephemeral: true });
        }
    },
};
