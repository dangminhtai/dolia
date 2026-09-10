import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

const DICE_EMOJIS = {
    1: '⚀',
    2: '⚁',
    3: '⚂',
    4: '⚃',
    5: '⚄',
    6: '⚅'
};

function evaluateFortune(rolls, sides) {
    const total = rolls.reduce((acc, val) => acc + val, 0);
    const maxPossible = rolls.length * sides;
    const minPossible = rolls.length * 1;
    const ratio = (total - minPossible) / Math.max(maxPossible - minPossible, 1);

    if (rolls.length > 1 && rolls.every(r => r === 1)) {
        return {
            level: '💀 Vô Cùng Thử Thách',
            color: 0x95A5A6,
            message: 'Toàn ra 1! Đen bạc thì đỏ tình, đừng lo lắng quá nhé!'
        };
    }

    if (rolls.length > 1 && rolls.every(r => r === sides)) {
        return {
            level: '🌟 Tuyệt Phẩm Đại Cát',
            color: 0xF1C40F,
            message: 'Tất cả các xúc xắc đều đạt điểm tối đa! Vận may bùng nổ, làm gì cũng thắng!'
        };
    }

    if (ratio >= 0.85) {
        return {
            level: '✨ Đại Cát - May Mắn Ngập Tràn',
            color: 0x2ECC71,
            message: 'Hôm nay thần tài gõ cửa, hãy thử những dự định mới mẻ nhé!'
        };
    } else if (ratio >= 0.6) {
        return {
            level: '🍀 Trung Cát - Rất Tốt Lành',
            color: 0x3498DB,
            message: 'Vận khí đang lên, mọi việc sẽ diễn ra suôn sẻ và êm đẹp.'
        };
    } else if (ratio >= 0.35) {
        return {
            level: '🌤️ Tiểu Cát - Bình An',
            color: 0xE67E22,
            message: 'Một ngày cân bằng và ổn định. Giữ tinh thần lạc quan nha!'
        };
    } else {
        return {
            level: '🌧️ Cần Thêm Chút May Mắn',
            color: 0xE74C3C,
            message: 'Điểm số hơi khiêm tốn tí thôi, xúc xắc chỉ là tạm thời, tự tin lên nhé!'
        };
    }
}

function generateRollEmbed(user, count, sides, rolls) {
    const total = rolls.reduce((acc, val) => acc + val, 0);
    const maxPossible = count * sides;
    const fortune = evaluateFortune(rolls, sides);

    const formattedRolls = rolls.map(r => {
        if (sides === 6 && DICE_EMOJIS[r]) {
            return `${DICE_EMOJIS[r]} **${r}**`;
        }
        return `[ **${r}** ]`;
    }).join('  +  ');

    const embed = new EmbedBuilder()
        .setColor(fortune.color)
        .setTitle(`🎲 Kết Quả Tung Xúc Xắc: ${count}d${sides}`)
        .setAuthor({
            name: user.displayName || user.username,
            iconURL: user.displayAvatarURL({ dynamic: true })
        })
        .setDescription(`> ${formattedRolls} = **${total}** / ${maxPossible}\n\n**Đánh giá vận may:**\n${fortune.level}\n*"${fortune.message}"*`)
        .addFields(
            { name: '📊 Chi tiết', value: `• Số xúc xắc: \`${count}\`\n• Số mặt: \`${sides}\`\n• Điểm cao nhất: \`${Math.max(...rolls)}\`\n• Điểm thấp nhất: \`${Math.min(...rolls)}\``, inline: true },
            { name: '🎯 Tỉ lệ may mắn', value: `\`${Math.round((total / maxPossible) * 100)}%\``, inline: true }
        )
        .setFooter({ text: 'Dolia Bot • Tung xúc xắc giải trí', iconURL: 'https://i.imgur.com/8Qp4c9L.png' })
        .setTimestamp();

    return embed;
}

export default {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Tung xúc xắc may mắn và kiểm tra vận số của bạn')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Số lượng xúc xắc muốn tung (1 - 6)')
                .setMinValue(1)
                .setMaxValue(6)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('sides')
                .setDescription('Số mặt của mỗi xúc xắc (mặc định 6 mặt)')
                .setMinValue(2)
                .setMaxValue(100)
                .setRequired(false)
        ),

    async execute(interaction) {
        try {
            const count = interaction.options.getInteger('count') || 1;
            const sides = interaction.options.getInteger('sides') || 6;

            const performRoll = () => {
                const rolls = [];
                for (let i = 0; i < count; i++) {
                    rolls.push(Math.floor(Math.random() * sides) + 1);
                }
                return rolls;
            };

            let currentRolls = performRoll();
            const embed = generateRollEmbed(interaction.user, count, sides, currentRolls);

            const rerollButton = new ButtonBuilder()
                .setCustomId(`reroll_dice_${interaction.id}`)
                .setLabel('Tung lại 🎲')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(rerollButton);

            const response = await interaction.reply({
                embeds: [embed],
                components: [row]
            });

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: (i) => i.customId === `reroll_dice_${interaction.id}`,
                time: 60_000
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({
                        content: t('dice.not_your_turn', { default: '❌ Chỉ người tung xúc xắc ban đầu mới được nhấn nút này!' }),
                        ephemeral: true
                    });
                }

                currentRolls = performRoll();
                const updatedEmbed = generateRollEmbed(interaction.user, count, sides, currentRolls);
                await i.update({
                    embeds: [updatedEmbed],
                    components: [row]
                });
            });

            collector.on('end', async () => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(rerollButton).setDisabled(true)
                );
                await interaction.editReply({ components: [disabledRow] }).catch(() => null);
            });

        } catch (error) {
            console.error('Lỗi khi thực hiện lệnh dice:', error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'Đã có lỗi xảy ra khi tung xúc xắc. Vui lòng thử lại sau!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Đã có lỗi xảy ra khi tung xúc xắc. Vui lòng thử lại sau!', ephemeral: true });
            }
        }
    }
};