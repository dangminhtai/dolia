import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('guess_number')
        .setDescription('Chơi trò chơi đoán số may mắn từ 1 đến 100')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
    async execute(interaction) {
        try {
            const targetNumber = Math.floor(Math.random() * 100) + 1;
            let attempts = 0;
            const maxAttempts = 7;

            const embed = new EmbedBuilder()
                .setTitle('🎯 Trò Chơi Đoán Số May Mắn')
                .setDescription('Bot đã chọn một số bí mật từ **1 đến 100**.\nBạn có **7 lượt đoán**. Hãy nhập số của bạn hoặc sử dụng các nút gợi ý bên dưới!')
                .setColor(0x3498DB)
                .addFields(
                    { name: 'Số lượt đã đoán', value: `0/${maxAttempts}`, inline: true },
                    { name: 'Trạng thái', value: 'Đang diễn ra...', inline: true }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('guess_help')
                    .setLabel('Hướng dẫn')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('guess_quit')
                    .setLabel('Bỏ cuộc')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ embeds: [embed], components: [row] });

            const filter = i => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageCollector({ filter, time: 60000 });

            collector.on('collect', async m => {
                try {
                    if (m.author.bot) return;
                    const guess = parseInt(m.content);

                    if (isNaN(guess)) {
                        return;
                    }

                    await m.delete().catch(() => {});
                    attempts++;

                    if (guess === targetNumber) {
                        collector.stop('won');
                    } else if (attempts >= maxAttempts) {
                        collector.stop('lost');
                    } else {
                        const hint = guess < targetNumber ? '📈 Số bí mật **CAO HƠN**!' : '📉 Số bí mật **THẤP HƠN**!';
                        embed.setFields(
                            { name: 'Số lượt đã đoán', value: `${attempts}/${maxAttempts}`, inline: true },
                            { name: 'Gợi ý gần nhất', value: `${hint} (Bạn đoán: ${guess})`, inline: false }
                        );
                        await interaction.editReply({ embeds: [embed] });
                    }
                } catch (err) {
                    console.error(err);
                }
            });

            collector.on('end', async (collected, reason) => {
                try {
                    const finalEmbed = EmbedBuilder.from(embed);
                    if (reason === 'won') {
                        finalEmbed
                            .setColor(0x2ECC71)
                            .setTitle('🎉 Chúc Mừng Bạn Đã Thắng!')
                            .setDescription(`Bạn đã đoán đúng số **${targetNumber}** sau **${attempts}** lượt đoán!`);
                    } else if (reason === 'lost') {
                        finalEmbed
                            .setColor(0xE74C3C)
                            .setTitle('❌ Trò Chơi Kết Thúc')
                            .setDescription(`Bạn đã hết lượt đoán. Số bí mật là: **${targetNumber}**`);
                    } else {
                        finalEmbed
                            .setColor(0x95A5A6)
                            .setTitle('⏰ Hết Thời Gian')
                            .setDescription(`Đã hết thời gian chơi. Số bí mật là: **${targetNumber}**`);
                    }
                    await interaction.editReply({ embeds: [finalEmbed], components: [] });
                } catch (err) {
                    console.error(err);
                }
            });

        } catch (error) {
            console.error(error);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: 'Đã có lỗi xảy ra khi khởi chạy trò chơi!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Đã có lỗi xảy ra khi khởi chạy trò chơi!', ephemeral: true });
            }
        }
    }
};