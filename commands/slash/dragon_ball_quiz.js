import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

const questions = [
    {
        question: "Tên thật của Goku khi sinh ra ở hành tinh Vegeta là gì?",
        options: ["Kakarot", "Raditz", "Bardock", "Broly"],
        correct: 0
    },
    {
        question: "Ai là người đầu tiên đạt trạng thái Super Saiyan trong cốt truyện chính?",
        options: ["Goku", "Vegeta", "Gohan", "Future Trunks"],
        correct: 0
    },
    {
        question: "Chiêu thức tối thượng kết hợp năng lượng từ khắp vũ trụ của Goku tên là gì?",
        options: ["Kamehameha", "Spirit Bomb (Genki Dama)", "Final Flash", "Special Beam Cannon"],
        correct: 1
    },
    {
        question: "Viên ngọc rồng ở Trái Đất có màu gì khi triệu hồi rồng thần Shenron?",
        options: ["Đỏ", "Cam", "Vàng sáng rực", "Xanh lá"],
        correct: 3
    },
    {
        question: "Giải đấu sức mạnh (Tournament of Power) diễn ra ở không gian nào?",
        options: ["Vương quốc Hư Không (World of Void)", "Hành tinh Beerus", "Đại hội võ thuật thế giới", "Điện thần Kami"],
        correct: 0
    }
];

export default {
    data: new SlashCommandBuilder()
        .setName('dragon_ball_quiz')
        .setDescription('Thử tài kiến thức về thế giới Dragon Ball (7 Viên Ngọc Rồng) dành cho fan cứng!')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
    async execute(interaction) {
        try {
            await interaction.deferReply();

            const qIndex = Math.floor(Math.random() * questions.length);
            const currentQ = questions[qIndex];

            const embed = new EmbedBuilder()
                .setTitle('🐉 Dragon Ball Quiz - Thử Thách Fan Cứng')
                .setDescription(`**Câu hỏi:** ${currentQ.question}`)
                .setColor(0xFF6600)
                .setFooter({ text: `Được yêu cầu bởi ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                .setTimestamp();

            const row = new ActionRowBuilder();
            const emojis = ['🇦', '🇧', '🇨', '🇩'];

            currentQ.options.forEach((opt, idx) => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`dbz_quiz_${idx}_${idx === currentQ.correct ? 'win' : 'lose'}`)
                        .setLabel(`${emojis[idx]} ${opt}`)
                        .setStyle(ButtonStyle.Primary)
                );
            });

            const message = await interaction.editReply({ embeds: [embed], components: [row] });

            const collector = message.createMessageComponentCollector({ time: 30000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'Đây không phải là câu hỏi dành cho bạn!', ephemeral: true });
                    return;
                }

                const isCorrect = i.customId.endsWith('_win');
                const resultEmbed = new EmbedBuilder()
                    .setTitle('🐉 Dragon Ball Quiz - Kết Quả')
                    .setColor(isCorrect ? 0x2ECC71 : 0xE74C3C)
                    .setDescription(
                        isCorrect 
                            ? `🎉 **Chính xác!** Bạn thực sự là một fan cứng của Dragon Ball!` 
                            : `❌ **Sai rồi!** Đáp án đúng là: **${currentQ.options[currentQ.correct]}**`
                    );

                const disabledRow = new ActionRowBuilder();
                currentQ.options.forEach((opt, idx) => {
                    disabledRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`disabled_${idx}`)
                            .setLabel(`${emojis[idx]} ${opt}`)
                            .setStyle(idx === currentQ.correct ? ButtonStyle.Success : ButtonStyle.Secondary)
                            .setDisabled(true)
                    );
                });

                await i.update({ embeds: [resultEmbed], components: [disabledRow] });
                collector.stop();
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('🐉 Dragon Ball Quiz - Hết Giờ')
                        .setColor(0x95A5A6)
                        .setDescription(`⏰ Đã hết thời gian trả lời! Đáp án đúng là: **${currentQ.options[currentQ.correct]}**`);

                    const disabledRow = new ActionRowBuilder();
                    currentQ.options.forEach((opt, idx) => {
                        disabledRow.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`timeout_${idx}`)
                                .setLabel(`${emojis[idx]} ${opt}`)
                                .setStyle(idx === currentQ.correct ? ButtonStyle.Success : ButtonStyle.Secondary)
                                .setDisabled(true)
                        );
                    });

                    await interaction.editReply({ embeds: [timeoutEmbed], components: [disabledRow] }).catch(() => {});
                }
            });

        } catch (error) {
            console.error(error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: 'Đã có lỗi xảy ra khi khởi tạo câu hỏi Dragon Ball!', embeds: [], components: [] });
            } else {
                await interaction.reply({ content: 'Đã có lỗi xảy ra khi khởi tạo câu hỏi Dragon Ball!', ephemeral: true });
            }
        }
    }
};
