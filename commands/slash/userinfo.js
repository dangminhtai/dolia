import { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Xem thông tin chi tiết về người dùng Discord')
        .addUserOption(option =>
            option
                .setName('target')
                .setDescription('Người dùng bạn muốn xem thông tin')
                .setRequired(false)
        )
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
    async execute(interaction) {
        try {
            await interaction.deferReply();

            const targetUser = interaction.options.getUser('target') || interaction.user;
            const member = interaction.guild ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) : null;

            const createdAt = Math.floor(targetUser.createdTimestamp / 1000);
            const joinedAt = member && member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

            const embed = new EmbedBuilder()
                .setColor(member?.displayHexColor !== '#000000' && member?.displayHexColor ? member.displayHexColor : 0x3498DB)
                .setAuthor({
                    name: `${targetUser.tag}`,
                    iconURL: targetUser.displayAvatarURL({ dynamic: true, size: 256 })
                })
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 512 }))
                .addFields(
                    {
                        name: '🆔 ID',
                        value: `\`${targetUser.id}\``,
                        inline: true
                    },
                    {
                        name: '🤖 Bot?',
                        value: targetUser.bot ? 'Có' : 'Không',
                        inline: true
                    },
                    {
                        name: '📅 Tạo tài khoản',
                        value: `<t:${createdAt}:F>\n(<t:${createdAt}:R>)`,
                        inline: false
                    }
                );

            if (member) {
                const roles = member.roles.cache
                    .filter(role => role.id !== interaction.guild.id)
                    .sort((a, b) => b.position - a.position)
                    .map(role => role.toString());

                const rolesString = roles.length > 0 
                    ? (roles.length > 10 ? roles.slice(0, 10).join(', ') + ` và ${roles.length - 10} vai trò khác...` : roles.join(', '))
                    : 'Không có';

                embed.addFields(
                    {
                        name: '📥 Tham gia Server',
                        value: joinedAt ? `<t:${joinedAt}:F>\n(<t:${joinedAt}:R>)` : 'Không xác định',
                        inline: false
                    },
                    {
                        name: `🛡️ Vai trò (${roles.length})`,
                        value: rolesString,
                        inline: false
                    }
                );
            }

            embed.setFooter({
                text: `Yêu cầu bởi ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true })
            }).setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Lỗi khi thực thi lệnh userinfo:', error);
            const errorMessage = { content: 'Đã xảy ra lỗi khi lấy thông tin người dùng này.', ephemeral: true };
            if (interaction.deferred) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    }
};