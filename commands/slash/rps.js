import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType, ComponentType } from 'discord.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Chơi oẳn tù tì với Bot Dolia')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),

    async execute(interaction) {
        try {
            await runGame(interaction);
        } catch (error) {
            console.error('Error in RPS command:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: 'Đã xảy ra lỗi khi thực hiện trò chơi này!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Đã xảy ra lỗi khi thực hiện trò chơi này!', ephemeral: true });
            }
        }
    }
};

async function runGame(interaction, buttonInteraction = null) {
    const user = buttonInteraction ? buttonInteraction.user : interaction.user;
    const guildId = interaction.guildId;

    const choices = {
        rock: { emoji: '✊', label: t(guildId, 'rps.rock') || 'Búa', beats: 'scissors' },
        paper: { emoji: '✋', label: t(guildId, 'rps.paper') || 'Bao', beats: 'rock' },
        scissors: { emoji: '✌️', label: t(guildId, 'rps.scissors') || 'Kéo', beats: 'paper' }
    };

    const embed = new EmbedBuilder()
        .setTitle(t(guildId, 'rps.title') || '✊ Oẳn Tù Tì ✌️')
        .setDescription(t(guildId, 'rps.choose_prompt') || 'Hãy chọn một trong các lựa chọn dưới đây để đấu với Bot!')
        .setColor(0x3498DB)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rps_rock').setLabel(choices.rock.label).setEmoji(choices.rock.emoji).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rps_paper').setLabel(choices.paper.label).setEmoji(choices.paper.emoji).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rps_scissors').setLabel(choices.scissors.label).setEmoji(choices.scissors.emoji).setStyle(ButtonStyle.Primary)
    );

    let message;
    if (buttonInteraction) {
        message = await buttonInteraction.update({ embeds: [embed], components: [row], fetchReply: true });
    } else {
        message = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    }

    const filter = async (i) => {
        if (i.user.id !== user.id) {
            await i.reply({
                content: t(guildId, 'rps.only_author') || 'Chỉ người kích hoạt lệnh mới có thể tương tác!',
                ephemeral: true
            });
            return false;
        }
        return true;
    };

    const collector = message.createMessageComponentCollector({
        filter,
        componentType: ComponentType.Button,
        time: 30000
    });

    collector.on('collect', async (i) => {
        if (!i.customId.startsWith('rps_')) return;
        collector.stop('played');

        const userChoiceKey = i.customId.replace('rps_', '');
        const botChoiceKey = Object.keys(choices)[Math.floor(Math.random() * 3)];

        const userChoice = choices[userChoiceKey];
        const botChoice = choices[botChoiceKey];

        let resultMessage = '';
        let color = 0x3498DB;

        if (userChoiceKey === botChoiceKey) {
            resultMessage = t(guildId, 'rps.draw') || 'Hòa rồi! 🤝';
            color = 0xF1C40F;
        } else if (userChoice.beats === botChoiceKey) {
            resultMessage = t(guildId, 'rps.win') || 'Bạn đã thắng! 🎉';
            color = 0x2ECC71;
        } else {
            resultMessage = t(guildId, 'rps.lose') || 'Bạn đã thua! 😢';
            color = 0xE74C3C;
        }

        const resultDescTemplate = t(guildId, 'rps.result_desc') || 'Bạn chọn: {userEmoji} **{userLabel}**\nBot chọn: {botEmoji} **{botLabel}**\n\n**Kết quả:** {result}';
        const resultDesc = resultDescTemplate
            .replace('{userEmoji}', userChoice.emoji)
            .replace('{userLabel}', userChoice.label)
            .replace('{botEmoji}', botChoice.emoji)
            .replace('{botLabel}', botChoice.label)
            .replace('{result}', resultMessage);

        const resultEmbed = new EmbedBuilder()
            .setTitle(t(guildId, 'rps.title') || '✊ Oẳn Tù Tì ✌️')
            .setDescription(resultDesc)
            .setColor(color)
            .setTimestamp();

        const playAgainRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rps_play_again')
                .setLabel(t(guildId, 'rps.play_again') || 'Chơi lại')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Success)
        );

        const resultMsg = await i.update({ embeds: [resultEmbed], components: [playAgainRow], fetchReply: true });

        const playAgainCollector = resultMsg.createMessageComponentCollector({
            filter,
            componentType: ComponentType.Button,
            time: 15000
        });

        playAgainCollector.on('collect', async (playAgainInt) => {
            if (playAgainInt.customId === 'rps_play_again') {
                playAgainCollector.stop('restarted');
                await runGame(interaction, playAgainInt);
            }
        });

        playAgainCollector.on('end', async (collected, reason) => {
            if (reason !== 'restarted') {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('rps_play_again')
                        .setLabel(t(guildId, 'rps.play_again') || 'Chơi lại')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(true)
                );
                try {
                    await resultMsg.edit({ components: [disabledRow] });
                } catch (err) {
                    // Ignore if message was deleted
                }
            }
        });
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
            const timeoutEmbed = new EmbedBuilder()
                .setTitle(t(guildId, 'rps.title') || '✊ Oẳn Tù Tì ✌️')
                .setDescription(t(guildId, 'rps.timeout') || 'Hết thời gian lựa chọn!')
                .setColor(0x95A5A6)
                .setTimestamp();

            try {
                await message.edit({ embeds: [timeoutEmbed], components: [] });
            } catch (err) {
                // Ignore if message was deleted
            }
        }
    });
}