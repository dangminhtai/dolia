//utils/christmasGameUtils.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } from 'discord.js';
import { TREE_CONFIG } from '../config/christmasTreeConfig.js';

// Helper: Phân tích cây thành dạng lưới (Grid) để dễ tính toán
const parseTreeToGrid = (treeString) => {
    return treeString.split('\n').map(row => [...row]); // Chuyển thành mảng 2 chiều ký tự
};

// Helper: Chuyển lưới ngược lại thành String
const gridToString = (grid) => {
    return grid.map(row => row.join('')).join('\n');
};

// Helper: Check if game should finish based on config
export const checkGameFinished = (treeState) => {
    const totalSlots = (treeState.match(/🎄/g) || []).length + (treeState.match(/🍬|🎀|🎁|💖/g) || []).length;
    const remainingLeaves = (treeState.match(/🎄/g) || []).length;
    const filledSlots = totalSlots - remainingLeaves;

    // Finish nếu cây đã đầy >= maxFillPercent (hoặc hết chỗ)
    return remainingLeaves === 0 || (filledSlots / totalSlots) >= TREE_CONFIG.gameRules.maxFillPercent;
};

// 1. Logic Tính điểm thông minh (Scoring Algorithm)
const calculateScore = (grid, row, col, itemEmoji) => {
    let score = 0;

    score += 10;


    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let emptyNeighbors = 0;

    directions.forEach(([dx, dy]) => {
        const checkRow = row + dx;
        const checkCol = col + dy;
        if (grid[checkRow] && grid[checkRow][checkCol] === '🎄') {
            emptyNeighbors++;
        }
    });
    score += (emptyNeighbors * TREE_CONFIG.gameRules.isolationBonus);

    // --- LUẬT 2: COMBO 3 (3 in a row) ---
    // Kiểm tra hàng ngang xem có tạo thành chuỗi 3 icon giống nhau không
    // (Logic đơn giản hóa: đếm số lượng itemEmoji trong hàng)
    const rowContent = grid[row];
    let consecutive = 0;
    for (let c = 0; c < rowContent.length; c++) {
        if (rowContent[c] === itemEmoji) consecutive++;
        else consecutive = 0;

        if (consecutive >= 3) {
            score += TREE_CONFIG.gameRules.comboBonus;
            break; // Chỉ tính 1 lần combo
        }
    }

    return score;
};

// 2. Hàm trang trí chính (Dùng cho cả Random và Chọn vị trí)
export const decorateTree = (currentTreeState, itemKey, specificPos = null) => {
    const grid = parseTreeToGrid(currentTreeState);
    const item = TREE_CONFIG.items[itemKey];

    // Tìm tất cả vị trí khả dụng (là '🎄')
    const availableSpots = [];
    grid.forEach((row, rIndex) => {
        row.forEach((char, cIndex) => {
            if (char === '🎄') {
                availableSpots.push({ r: rIndex, c: cIndex });
            }
        });
    });

    // Kiểm tra điều kiện kết thúc (Quá đầy)
    // Ước lượng tổng số slot (🎄 là chưa dùng, các icon khác là đã dùng)
    const totalSlots = (currentTreeState.match(/🎄/g) || []).length + (currentTreeState.match(/🍬|🎀|🎁|💖/g) || []).length;
    const filledSlots = totalSlots - availableSpots.length;
    const currentFillPercent = filledSlots / totalSlots;

    // Nếu đã đầy quá giới hạn config -> Full
    if (availableSpots.length === 0 || currentFillPercent >= TREE_CONFIG.gameRules.maxFillPercent) {
        return { success: false, reason: 'FULL' };
    }

    // Xác định vị trí đặt
    let targetSpot;
    if (specificPos) {
        // Người dùng chọn vị trí cụ thể: "r_c"
        const [r, c] = specificPos.split('_').map(Number);
        // Validate xem vị trí đó còn trống không (đề phòng 2 người bấm cùng lúc)
        if (grid[r][c] !== '🎄') return { success: false, reason: 'TAKEN' };
        targetSpot = { r, c };
    } else {
        // Random
        targetSpot = availableSpots[Math.floor(Math.random() * availableSpots.length)];
    }

    // A. Tính Isolation trên grid cũ
    let scoreEarned = calculateScore(grid, targetSpot.r, targetSpot.c, item.emoji);

    // B. Cập nhật Grid
    grid[targetSpot.r][targetSpot.c] = item.emoji;

    return {
        success: true,
        newTree: gridToString(grid),
        score: scoreEarned + item.points
    };
};

// 3. Tạo UI (Buttons + Select Menu)
export const createGameUI = (gameData, hostName, hostAvatar) => {
    // A. XỬ LÝ KHI GAME KẾT THÚC
    if (gameData.isFinished) {
        // Tìm người chiến thắng
        let winnerText = TREE_CONFIG.gameResult.noPlayers;
        if (gameData.scores.size > 0) {
            let maxScore = -1;
            let winners = [];

            for (const [id, score] of gameData.scores.entries()) {
                if (score > maxScore) {
                    maxScore = score;
                    winners = [id];
                } else if (score === maxScore) {
                    winners.push(id);
                }
            }

            if (winners.length > 1) {
                winnerText = TREE_CONFIG.gameResult.draw;
            } else {
                const name = gameData.names.get(winners[0]);
                winnerText = TREE_CONFIG.gameResult.winner(name, maxScore);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(TREE_CONFIG.titles.finished)
            .setDescription(TREE_CONFIG.descriptions.finished(winnerText, gameData.treeState))
            .setColor(TREE_CONFIG.colors.finished)
            .setFooter({ text: `Host: ${hostName}`, iconURL: hostAvatar });

        return { embeds: [embed], components: [] }; // Không còn nút bấm
    }

    // B. XỬ LÝ KHI GAME ĐANG CHẠY
    let description = TREE_CONFIG.descriptions.active(
        Array.from(gameData.scores.entries())
            .map(([id, s]) => `${gameData.names.get(id)}: ${s}`)
            .join(', ') || "Chưa có",
        gameData.treeState
    );

    if (gameData.stopRequesterId) {
        const requesterName = gameData.names.get(gameData.stopRequesterId) || "Người chơi";
        description += `\n\n${TREE_CONFIG.messages.stopRequested(requesterName)}`;
    }

    const embed = new EmbedBuilder()
        .setTitle(TREE_CONFIG.titles.active)
        .setDescription(description)
        .setColor(TREE_CONFIG.colors.active)
        .setFooter({ text: `Host: ${hostName}`, iconURL: hostAvatar });

    const components = [];

    if (!gameData.stopRequesterId) {
        // --- TRẠNG THÁI BÌNH THƯỜNG ---

        // Row 1: Các nút Item (Spam Random)
        const rowButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId(TREE_CONFIG.buttons.customIds.candy).setEmoji(TREE_CONFIG.items.candy.emoji).setLabel('Kẹo').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(TREE_CONFIG.buttons.customIds.bow).setEmoji(TREE_CONFIG.items.bow.emoji).setLabel('Nơ').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(TREE_CONFIG.buttons.customIds.gift).setEmoji(TREE_CONFIG.items.gift.emoji).setLabel('Quà').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(TREE_CONFIG.buttons.customIds.heart).setEmoji(TREE_CONFIG.items.heart.emoji).setLabel('Tim').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(TREE_CONFIG.buttons.customIds.stop).setEmoji('🛑').setLabel('Kết thúc').setStyle(ButtonStyle.Danger),
            );
        components.push(rowButtons);

        // Row 2: Select Menu
        const grid = parseTreeToGrid(gameData.treeState);
        const options = [];
        let count = 0;
        grid.forEach((row, r) => {
            row.forEach((char, c) => {
                if (char === '🎄' && count < 20) { // Giảm xuống 20 để tránh quá tải
                    const realIndex = row.slice(0, c).filter(x => x !== ' ').length + 1;
                    options.push({
                        label: `Hàng ${r + 1} - Vị trí ${realIndex}`,
                        description: 'Đặt vật phẩm vào đây (+ điểm chiến thuật)',
                        value: `pos_${r}_${c}`,
                        emoji: '🎯'
                    });
                    count++;
                }
            });
        });

        if (options.length > 0) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(TREE_CONFIG.buttons.customIds.select_pos)
                    .setPlaceholder('🎯 Chọn vị trí cụ thể (Snipe)')
                    .addOptions(options)
            ));
        }

    } else {
        // --- TRẠNG THÁI YÊU CẦU STOP ---
        const rowStop = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(TREE_CONFIG.buttons.customIds.approve_stop)
                    .setLabel('Đồng ý Kết thúc')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(TREE_CONFIG.buttons.customIds.stop) // Dùng lại ID stop để làm nút Cancel (logic xử lý sẽ check)
                    .setLabel('Hủy yêu cầu')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❌')
            );
        components.push(rowStop);
    }

    return { embeds: [embed], components: components };
};