// commands/slash/tictactoe.js
import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tictactoe')
        .setDescription('Chơi Tic-Tac-Toe cùng nhau')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('Chọn bạn để chơi cùng')
                .setRequired(false)
        ),

    async execute(interaction) {
        try {
            const opponent = interaction.options.getUser('opponent');

            // Initial State
            const gameState = {
            board: Array(9).fill(null), // 0-8
            player1: interaction.user,
            player2: opponent || null, // If null, waiting for join
            turn: 'X', // X always starts
            isGameOver: false
        };

        // Helper to Create Board UI
        function createBoardComponents(state, disabled = false) {
            const rows = [];
            for (let i = 0; i < 3; i++) {
                const row = new ActionRowBuilder();
                for (let j = 0; j < 3; j++) {
                    const index = i * 3 + j;
                    const val = state.board[index];

                    // --- SỬA LỖI Ở ĐÂY ---
                    // Sử dụng \u200b (Zero Width Space) thay vì khoảng trắng thường
                    let label = val ? val : '\u200b';
                    let style = ButtonStyle.Secondary;

                    if (val === 'X') {
                        style = ButtonStyle.Danger; // Red for X
                    } else if (val === 'O') {
                        style = ButtonStyle.Primary; // Blue for O
                    }

                    const btn = new ButtonBuilder()
                        .setCustomId(`ttt_move_${index}`)
                        .setLabel(label)
                        .setStyle(style)
                        .setDisabled(disabled || val !== null); // Disable if cell filled or game over

                    row.addComponents(btn);
                }
                rows.push(row);
            }

            const controlRow = new ActionRowBuilder();

            if (!state.player2) {
                controlRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId('ttt_join')
                        .setLabel(t('games.tictactoe.join_button'))
                        .setStyle(ButtonStyle.Success)
                );
            }

            // Trả về object components
            return {
                components: !state.player2 ? [controlRow] : [], // Chỉ hiện nút Join nếu chưa đủ người, nút Join tách biệt với bàn cờ lúc đầu
                rowsWithBoard: rows,
                controlRow
            };
        }

        // Helper content
        function getContent(state) {
            if (state.isGameOver) {
                // Logic hiển thị người thắng cuộc đơn giản hóa
                // Vì turn đã đổi sau nước đi cuối cùng, người thắng là người của turn trước đó
                const winner = state.turn === 'X' ? state.player2 : state.player1;
                return t('games.tictactoe.game_over');
            }

            if (!state.player2) {
                return t('games.tictactoe.waiting', { player1: state.player1 });
            }

            //  - Minh họa giao diện game
            const currentPlayer = state.turn === 'X' ? state.player1 : state.player2;
            return t('games.tictactoe.turn', {
                player1: state.player1,
                player2: state.player2,
                current: currentPlayer,
                symbol: state.turn
            });
        }

        // Initial Reply preparation
        const { rowsWithBoard, controlRow } = createBoardComponents(gameState);

        let initialComponents = [];
        if (!gameState.player2) {
            // Khi chờ người chơi: Hiện bàn cờ + Nút Join
            initialComponents = [...rowsWithBoard, controlRow];
        } else {
            // Khi đã đủ người: Chỉ hiện bàn cờ
            initialComponents = rowsWithBoard;
        }

        // --- SỬA LỖI WARNING ---
        // Bỏ 'fetchReply: true' vì interaction.reply mặc định trả về Response trong các phiên bản mới nếu dùng await
        const response = await interaction.reply({
            content: getContent(gameState),
            components: initialComponents,
            withResponse: true // Dùng cái này thay cho fetchReply để lấy message object về
        });

        // Collector
        // Lưu ý: response ở đây có thể là InteractionResponse hoặc Message tùy version, dùng response.resource?.message hoặc gọi fetch() nếu cần
        // Tuy nhiên, cách an toàn nhất trong discord.js v14+ là dùng interaction.channel.createMessageComponentCollector 
        // hoặc response.createMessageComponentCollector nếu response là message.

        // Để an toàn nhất với code hiện tại:
        const message = response.resource ? response.resource.message : response;

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000 // 5 minutes
        });

        collector.on('collect', async i => {
            // 1. Join Request
            if (i.customId === 'ttt_join') {
                if (gameState.player2) return i.reply({ content: t('games.tictactoe.room_full'), ephemeral: true });

                gameState.player2 = i.user;

                // Re-render board immediately to start game
                // Khi đã join, chỉ hiển thị bàn cờ (bỏ nút Join)
                const ui = createBoardComponents(gameState);
                await i.update({
                    content: getContent(gameState),
                    components: ui.rowsWithBoard
                });
                return;
            }

            // 2. Gameplay Move
            if (i.customId.startsWith('ttt_move_')) {
                const currentUser = gameState.turn === 'X' ? gameState.player1 : gameState.player2;

                if (i.user.id !== currentUser.id) {
                    return i.reply({ content: t('games.tictactoe.not_your_turn'), ephemeral: true });
                }

                const index = parseInt(i.customId.split('_')[2]);

                // Update Board
                gameState.board[index] = gameState.turn;

                // Check Win
                const won = checkWin(gameState.board);
                if (won) {
                    gameState.isGameOver = true;
                    const finalRows = createBoardComponents(gameState, true).rowsWithBoard;
                    await i.update({
                        content: t('games.tictactoe.winner', {
                            winner: i.user,
                            symbol: gameState.turn,
                            selfComment: gameState.player1.id === gameState.player2.id ? t('games.tictactoe.self_comment') : ''
                        }),
                        components: finalRows
                    });
                    collector.stop();
                    return;
                }

                // Check Draw
                if (!gameState.board.includes(null)) {
                    gameState.isGameOver = true;
                    const finalRows = createBoardComponents(gameState, true).rowsWithBoard;
                    await i.update({
                        content: t('games.tictactoe.draw'),
                        components: finalRows
                    });
                    collector.stop();
                    return;
                }

                // Switch Turn
                gameState.turn = gameState.turn === 'X' ? 'O' : 'X';

                await i.update({
                    content: getContent(gameState),
                    components: createBoardComponents(gameState).rowsWithBoard
                });
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                try {
                    if (!gameState.isGameOver) {
                        await interaction.editReply({
                            content: t('games.tictactoe.timeout'),
                            components: []
                        });
                    }
                } catch (e) { }
            }
        });

            // Utils
            function checkWin(board) {
                const lines = [
                    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
                    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
                    [0, 4, 8], [2, 4, 6]             // Diagonals
                ];
                for (let line of lines) {
                    const [a, b, c] = line;
                    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                        return true;
                    }
                }
                return false;
            }
        } catch (err) {
            console.error('[tictactoe]', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: t('games.tictactoe.error'), ephemeral: true }).catch(() => {});
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: t('games.tictactoe.error'), ephemeral: true }).catch(() => {});
                }
            } catch (_) {}
        }
    }
};