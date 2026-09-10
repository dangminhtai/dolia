//config/christmasTreeConfig.js
export const TREE_CONFIG = {
    // Game Data
    initialScoreText: "Chưa có điểm",
    thumbnailUrl: 'https://i.ibb.co/gGSfZ3c/icon-512.png',

    // UI Colors
    colors: {
        active: '#2ecc71',
        finished: '#f1c40f'
    },

    // UI Titles
    titles: {
        active: '🎄 TRANG TRÍ CÂY THÔNG NOEL CÙNG NHAU',
        finished: '🎅 KẾT QUẢ TRANG TRÍ'
    },
    initialScoreText: "Sẵn sàng trang trí!",
    items: {
        candy: { id: 'candy', emoji: '🍬', name: 'Kẹo', points: 10 },
        bow: { id: 'bow', emoji: '🎀', name: 'Nơ', points: 15 },
        gift: { id: 'gift', emoji: '🎁', name: 'Hộp quà', points: 20 },
        heart: { id: 'heart', emoji: '💖', name: 'Trái tim', points: 25 }
    },
    gameRules: {
        maxFillPercent: 0.75,
        comboBonus: 30,
        isolationBonus: 5,
    },

    // Messages / Descriptions
    descriptions: {
        active: (scoreText, treeState) => `**Luật chơi:** Spam nút để chiếm chỗ trên cây!\nAi treo được nhiều đồ hơn sẽ chiến thắng!\n\n**🏆 Tỉ số:** ${scoreText}\n\`\`\`text\n${treeState}\n\`\`\``,
        finished: (winnerText, treeState) => `**GAME KẾT THÚC!**\n\n${winnerText}\n\n**TÁC PHẨM HOÀN THIỆN:**\n\`\`\`text\n${treeState}\n\`\`\``
    },

    // Game Over Texts
    gameResult: {
        draw: "**HÒA NÈ, LẦN SAU HÃY THỬ LẠI!**",
        winner: (name, score) => `👑 **NGƯỜI CHƠI: ${name.toUpperCase()}** (${score} điểm)`,
        noPlayers: "Không ai chơi cả..."
    },

    // Button Labels
    buttons: {
        customIds: {
            candy: 'tree_add_candy',
            bow: 'tree_add_bow',
            gift: 'tree_add_gift',
            heart: 'tree_add_heart',
            select_pos: 'tree_select_pos',
            stop: 'tree_stop_game',
            approve_stop: 'tree_approve_stop'
        }
    },
    // Interaction Responses
    messages: {
        gameEnded: 'Lược chơi lần này đã kết thúc, hãy thử lại sau!',
        fullTree: 'Hết chỗ rồi! Chậm tay quá!',
        error: 'Lỗi game!',
        stopRequested: (user) => `⚠️ **${user}** muốn kết thúc trang trí. Nhấn nút **✅ Đồng ý** để duyệt!`,
        stopCancelled: 'Đã hủy yêu cầu kết thúc.',
        selfApprove: 'Bạn không thể tự duyệt yêu cầu của mình (cần người khác đồng ý)!'
    },

    // Slash Command
    command: {
        name: 'create-tree',
        description: 'Mini game Noel Tree đơn giản',
        options: {
            size: {
                name: 'size',
                description: 'Kích thước cây',
                choices: {
                    huge: 'Cây Thông Lớn (Huge)',
                    medium: 'Cây Thông Vừa (Medium)'
                }
            }
        }
    },

    // Tree Templates
    templates: {
        huge: "        🌟\n       🎄🎄\n      🎄🎄🎄\n     🎄🎄🎄🎄\n    🎄🎄🎄🎄🎄\n   🎄🎄🎄🎄🎄🎄\n  🎄🎄🎄🎄🎄🎄🎄\n       🟫🟫",
        medium: "      🌟\n     🎄🎄\n    🎄🎄🎄\n   🎄🎄🎄🎄\n     🟫🟫"
    }
};
