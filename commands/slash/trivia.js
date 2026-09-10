import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

const triviaQuestions = [
    {
        category: "Anime",
        question: "Trong bộ anime One Piece, ước mơ của Roronoa Zoro là gì?",
        options: [
            { text: "Trở thành Vua Hải Tặc", correct: false },
            { text: "Trở thành Kiếm sĩ vĩ đại nhất thế giới", correct: true },
            { text: "Tìm thấy kho báu All Blue", correct: false },
            { text: "Vẽ bản đồ toàn thế giới", correct: false }
        ]
    },
    {
        category: "Âm nhạc",
        question: "Nghệ sĩ nào được mệnh danh là 'Ông hoàng nhạc Pop'?",
        options: [
            { text: "Elvis Presley", correct: false },
            { text: "Freddie Mercury", correct: false },
            { text: "Michael Jackson", correct: true },
            { text: "Prince", correct: false }
        ]
    },
    {
        category: "Đời sống",
        question: "Hành tinh nào trong Hệ Mặt Trời được mệnh danh là 'Hành tinh Đỏ'?",
        options: [
            { text: "Kim Tinh", correct: false },
            { text: "Hỏa Tinh", correct: true },
            { text: "Mộc Tinh", correct: false },
            { text: "Thổ Tinh", correct: false }
        ]
    },
    {
        category: "Khoa học vui",
        question: "Loài động vật nào trên cạn chạy nhanh nhất thế giới?",
        options: [
            { text: "Sư tử", correct: false },
            { text: "Ngựa vằn", correct: false },
            { text: "Báo săn (Cheetah)", correct: true },
            { text: "Linh dương", correct: false }
        ]
    }
];

export default {
    data: new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Chơi trò chơi Đố vui kiến thức với các chủ đề thú vị và nhận điểm thưởng.')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
    async execute(interaction) {
        try {
            await interaction.deferReply();

            const randomQuestion = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
            const shuffledOptions = [...randomQuestion.options].sort(() => Math.random() - 0.5);

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`🎮 Trò chơi Trivia - Chủ đề: ${randomQuestion.category}`)
                .setDescription(`**${randomQuestion.question}**\n\nHãy chọn đáp án đúng bên dưới trong vòng 30 giây!`)
                .setFooter({ text: `Được yêu cầu bởi ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                .setTimestamp();

            const row = new ActionRowBuilder();
            const emojis = ['🇦', '🇧', '🇨', '🇩'];

            shuffledOptions.forEach((option, index) => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`trivia_${index}_${option.correct}`)
                        .setLabel(`${emojis[index]} ${option.text.length > 80 ? option.text.substring(0, 77) + '...' : option.text}`)
                        .setStyle(ButtonStyle.Primary)
                );
            });

            const response = await interaction.editReply({ embeds: [embed], components: [row] });

            const collectorFilter = i => i.user.id === interaction.user.id;
            try {
                const confirmation = await response.awaitMessageComponent({ filter: collectorFilter, time: 30000 });
                const [_, indexStr, isCorrectStr] = confirmation.customId.split('_');
                const isCorrect = isCorrectStr === 'true';

                const resultEmbed = new EmbedBuilder()
                    .setColor(isCorrect ? 0x2ECC71 : 0xE74C3C)
                    .setTitle(isCorrect ? '🎉 Chính xác!' : '❌ Rất tiếc, sai mất rồi!')
                    .setDescription(`Câu hỏi: **${randomQuestion.question}**\n\nĐáp án đúng là: **${shuffledOptions.find(o => o.correct).text}**`)
                    .setTimestamp();

                const disabledRow = new ActionRowBuilder();
                shuffledOptions.forEach((option, index) => {
                    disabledRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`disabled_${index}`)
                            .setLabel(`${emojis[index]} ${option.text.length > 80 ? option.text.substring(0, 77) + '...' : option.text}`)
                            .setStyle(option.correct ? ButtonStyle.Success : (index.toString() === indexStr && !isCorrect ? ButtonStyle.Danger : ButtonStyle.Secondary))
                            .setDisabled(true)
                    );
                });

                await confirmation.update({ embeds: [resultEmbed], components: [disabledRow] });
            } catch (e) {
                const timeoutEmbed = new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle('⏰ Hết thời gian!')
                    .setDescription(`Bạn đã không trả lời kịp thời gian quy định.\nĐáp án đúng là: **${shuffledOptions.find(o => o.correct).text}**`);

                const disabledRow = new ActionRowBuilder();
                shuffledOptions.forEach((option, index) => {
                    disabledRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`timeout_${index}`)
                            .setLabel(`${emojis[index]} ${option.text.length > 80 ? option.text.substring(0, 77) + '...' : option.text}`)
                            .setStyle(option.correct ? ButtonStyle.Success : ButtonStyle.Secondary)
                            .setDisabled(true)
                    );
                });

                await interaction.editReply({ embeds: [timeoutEmbed], components: [disabledRow] }).catch(() => {});
            }
        } catch (error) {
            console.error('Lỗi khi thực thi lệnh trivia:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: 'Đã xảy ra lỗi khi tải câu hỏi trivia. Vui lòng thử lại sau!', embeds: [], components: [] }).catch(() => {});
            } else {
                await interaction.reply({ content: 'Đã xảy ra lỗi khi tải câu hỏi trivia. Vui lòng thử lại sau!', ephemeral: true }).catch(() => {});
            }
        }
    }
};