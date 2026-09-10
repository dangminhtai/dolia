import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType, ComponentType } from 'discord.js';
import { t } from '../../services/i18nService.js';

const CHOICES = [
    { id: 'rock', emoji: '🪨', name: 'Búa' },
    { id: 'paper', emoji: '📄', name: 'Bao' },
    { id: 'scissors', emoji: '✂️', name: 'Kéo' }
];

const OUTCOMES = {
    rock: { scissors: 'win', paper: 'lose', rock: 'draw' },
    paper: { rock: 'win', scissors: 'lose', paper: 'draw' },
    scissors: { paper: 'win', rock: 'lose', scissors: 'draw' }
};

export default {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Chơi Oẳn tù tì (Kéo - Búa - Bao) cùng Dolia')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),

    async execute(interaction) {
        try {
            const initialRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rps_rock')
                    .setLabel('Búa')
                    .setEmoji('🪨')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('rps_paper')
                    .setLabel('Bao')
                    .setEmoji('📄')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('rps_scissors')
                    .setLabel('Kéo')
                    .setEmoji('✂️')
                    .setStyle(ButtonStyle.Primary)
            );

            const startEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('🎮 Oẳn Tù Tì Cùng Dolia')
                .setDescription(`${interaction.user}, hãy chọn một nước đi bên dưới trong vòng **30 giây** nhé!\n\n*Dolia đã chọn nước đi của mình rồi đó, đố bạn thắng được tôi!*`)
                .setFooter({ text: 'Dolia Games • Oẳn tù tì', iconURL: interaction.client.user.displayAvatarURL() })
                .setTimestamp();

            const response = await interaction.reply({
                embeds: [startEmbed],
                components: [initialRow],
                fetchReply: true
            });

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: (i) => i.user.id === interaction.user.id,
                time: 30000,
                max: 1
            });

            collector.on('collect', async (btnInteraction) => {
                const playerChoiceId = btnInteraction.customId.replace('rps_', '');
                const playerChoice = CHOICES.find((c) => c.id === playerChoiceId);
                const botChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)];

                const result = OUTCOMES[playerChoice.id][botChoice.id];

                let resultTitle = '';
                let resultColor = 0x3498DB;
                let resultQuote = '';

                if (result === 'win') {
                    resultTitle = '🎉 Bạn đã chiến thắng!';
                    resultColor = 0x2ECC71;
                    resultQuote = 'Đỉnh thật đấy! Lần sau Dolia nhất định sẽ gỡ lại!';
                } else if (result === 'lose') {
                    resultTitle = '😿 Dolia đã giành chiến thắng!';
                    resultColor = 0xE74C3C;
                    resultQuote = 'Lêu lêu~ Thần may mắn hôm nay đứng về phía Dolia rồi!';
                } else {
                    resultTitle = '🤝 Hòa nhau rồi!';
                    resultColor = 0xF1C40F;
                    resultQuote = 'Tâm đầu ý hợp ghê chưa, hai đứa mình chọn giống nhau nè!';
                }

                const disabledRow = new ActionRowBuilder().addComponents(
                    CHOICES.map((choice) => {
                        const isPlayerPick = choice.id === playerChoice.id;
                        let style = ButtonStyle.Secondary;
                        if (isPlayerPick) {
                            style = result === 'win' ? ButtonStyle.Success : result === 'lose' ? ButtonStyle.Danger : ButtonStyle.Primary;
                        }
                        return new ButtonBuilder()
                            .setCustomId(`rps_disabled_${choice.id}`)
                            .setLabel(choice.name)
                            .setEmoji(choice.emoji)
                            .setStyle(style)
                            .setDisabled(true);
                    })
                );

                const resultEmbed = new EmbedBuilder()
                    .setColor(resultColor)
                    .setTitle(resultTitle)
                    .setDescription(`> *"${resultQuote}"*`)
                    .addFields(
                        {
                            name: `👤 ${interaction.user.displayName}`,
                            value: `${playerChoice.emoji} **${playerChoice.name}**`,
                            inline: true
                        },
                        {
                            name: '⚡ Đối thủ',
                            value: 'vs',
                            inline: true
                        },
                        {
                            name: `🤖 ${interaction.client.user.username}`,
                            value: `${botChoice.emoji} **${botChoice.name}**`,
                            inline: true
                        }
                    )
                    .setFooter({ text: 'Dolia Games • Cảm ơn bạn đã chơi cùng tôi!', iconURL: interaction.client.user.displayAvatarURL() })
                    .setTimestamp();

                await btnInteraction.update({
                    embeds: [resultEmbed],
                    components: [disabledRow]
                });
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const timeoutRow = new ActionRowBuilder().addComponents(
                        CHOICES.map((choice) =>
                            new ButtonBuilder()
                                .setCustomId(`rps_timeout_${choice.id}`)
                                .setLabel(choice.name)
                                .setEmoji(choice.emoji)
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true)
                        )
                    );

                    const timeoutEmbed = new EmbedBuilder()
                        .setColor(0x95A5A6)
                        .setTitle('⌛ Hết thời gian!')
                        .setDescription('Bạn đã không ra đòn kịp thời gian quy định (30 giây). Ván đấu đã bị hủy!')
                        .setFooter({ text: 'Dolia Games • Hết giờ', iconURL: interaction.client.user.displayAvatarURL() });

                    await interaction.editReply({
                        embeds: [timeoutEmbed],
                        components: [timeoutRow]
                    }).catch(() => null);
                }
            });
        } catch (error) {
            console.error('Error executing /rps command:', error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: 'Đã xảy ra lỗi khi khởi động ván cược Oẳn tù tì. Vui lòng thử lại!',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: 'Đã xảy ra lỗi khi khởi động ván cược Oẳn tù tì. Vui lòng thử lại!',
                    ephemeral: true
                });
            }
        }
    }
};