import {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import { SelfDevService } from '../../services/selfDevService.js';
import geminiModelService from '../../services/geminiModelService.js';
import GeminiModel from '../../models/GeminiModel.js';

// Thời gian block mặc định
const BLOCK_DURATIONS = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    'permanent': 365 * 24 * 60 * 60 * 1000 // 1 năm ≈ permanent
};

const DURATION_LABELS = {
    '1h': '1 giờ',
    '6h': '6 giờ',
    '24h': '24 giờ',
    '7d': '7 ngày',
    'permanent': 'Vĩnh viễn'
};

export default {
    data: new SlashCommandBuilder()
        .setName('block-agent')
        .setDescription('Quản lý block/unblock model AI cho Agent pipeline (Chỉ Chủ nhân)')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Hành động muốn thực hiện')
                .setRequired(true)
                .addChoices(
                    { name: '🚫 Block model(s)', value: 'block' },
                    { name: '✅ Unblock model(s)', value: 'unblock' },
                    { name: '📊 Xem trạng thái', value: 'status' }
                )
        )
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Thời gian block (mặc định: 24h)')
                .setRequired(false)
                .addChoices(
                    { name: '1 giờ', value: '1h' },
                    { name: '6 giờ', value: '6h' },
                    { name: '24 giờ (Mặc định)', value: '24h' },
                    { name: '7 ngày', value: '7d' },
                    { name: 'Vĩnh viễn', value: 'permanent' }
                )
        ),

    async execute(interaction) {
        // Owner check
        if (!SelfDevService.isOwner(interaction.user.id)) {
            return interaction.reply({
                content: '🔒 Chỉ có chủ nhân mới được quản lý block model!',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const action = interaction.options.getString('action');
        const duration = interaction.options.getString('duration') || '24h';

        // Sync block cache trước
        await geminiModelService.syncBlockCache();

        // Lấy tất cả model từ DB
        const allModels = await GeminiModel.find({ isActive: true })
            .sort({ type: 1, versionMajor: -1, versionMinor: -1 })
            .lean();

        if (action === 'status') {
            return await showStatus(interaction, allModels);
        }

        if (action === 'block') {
            return await showBlockMenu(interaction, allModels, duration);
        }

        if (action === 'unblock') {
            return await showUnblockMenu(interaction, allModels);
        }
    }
};

/**
 * Hiển thị trạng thái tất cả model cho Agent
 */
async function showStatus(interaction, allModels) {
    const now = new Date();

    const lines = allModels.map(m => {
        const isBlocked = m.agentBlockedUntil && m.agentBlockedUntil > now;
        const statusIcon = isBlocked ? '🔴' : '🟢';
        const typeIcon = m.type === 'flash' ? '⚡' : '💡';

        let blockInfo = '';
        if (isBlocked) {
            const remaining = m.agentBlockedUntil - now;
            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);
            blockInfo = ` ── 🔒 Block Agent còn **${hours}h${minutes}m** (${m.agentBlockReason || 'N/A'})`;
        }

        return `${statusIcon} ${typeIcon} \`${m.modelId}\`${blockInfo}`;
    });

    const blockedCount = allModels.filter(m => m.agentBlockedUntil && m.agentBlockedUntil > now).length;

    const embed = new EmbedBuilder()
        .setTitle('📊 Trạng thái Model Agent (Antigravity & SelfDev)')
        .setDescription(
            (lines.join('\n') || 'Không có model nào trong database.') +
            '\n\n💡 *Lưu ý: Trạng thái block ở đây CHỈ áp dụng cho Antigravity & SelfDev Agent. Chat bình thường của Dolia KHÔNG bị block.*'
        )
        .setColor(blockedCount > 0 ? 0xFF6B6B : 0x51CF66)
        .setFooter({ text: `${allModels.length} model | ${blockedCount} đang bị block cho Agent` })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

/**
 * Hiển thị menu chọn model để block (chỉ model chưa bị block Agent)
 */
async function showBlockMenu(interaction, allModels, duration) {
    const now = new Date();
    const availableModels = allModels.filter(m => !m.agentBlockedUntil || m.agentBlockedUntil <= now);

    if (availableModels.length === 0) {
        return interaction.editReply({
            content: '⚠️ Tất cả model đều đang bị block cho Agent rồi! Dùng `unblock` để mở lại.'
        });
    }

    const options = availableModels.slice(0, 25).map(m => {
        const typeLabel = m.type === 'flash' ? '⚡Flash' : '💡Lite';
        return {
            label: m.modelId,
            description: `${typeLabel} | v${m.version}`,
            value: `blockagent_${m.modelId}_${duration}`,
            emoji: m.type === 'flash' ? '⚡' : '💡'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('blockagent_block_menu')
        .setPlaceholder(`🚫 Chọn model để block Agent (${DURATION_LABELS[duration]})`)
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('🚫 Block Model cho Agent (Antigravity & SelfDev)')
        .setDescription(
            `Chọn một hoặc nhiều model để block trong **${DURATION_LABELS[duration]}**.\n\n` +
            `• **Ảnh hưởng:** Antigravity Cloud Sandbox & SelfDev Pipeline sẽ bỏ qua các model này.\n` +
            `• **Chat thường:** Chat với Dolia **hoàn toàn KHÔNG bị ảnh hưởng** và vẫn dùng bình thường!`
        )
        .setColor(0xFF6B6B)
        .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [row] });
}

/**
 * Hiển thị menu chọn model để unblock (chỉ model đang bị block Agent)
 */
async function showUnblockMenu(interaction, allModels) {
    const now = new Date();
    const blockedModels = allModels.filter(m => m.agentBlockedUntil && m.agentBlockedUntil > now);

    if (blockedModels.length === 0) {
        return interaction.editReply({
            content: '✅ Không có model nào đang bị block cho Agent! Mọi thứ hoạt động bình thường.'
        });
    }

    const options = blockedModels.slice(0, 25).map(m => {
        const remaining = m.agentBlockedUntil - now;
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        return {
            label: m.modelId,
            description: `🔒 Còn ${hours}h${minutes}m | ${m.agentBlockReason || 'N/A'}`,
            value: `blockagent_unblock_${m.modelId}`,
            emoji: '🔴'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('blockagent_unblock_menu')
        .setPlaceholder('✅ Chọn model để unblock cho Agent')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('✅ Unblock Model cho Agent')
        .setDescription(
            `Chọn một hoặc nhiều model để gỡ block cho Agent.\n` +
            `Model được unblock sẽ ngay lập tức có thể được Antigravity/SelfDev sử dụng lại.`
        )
        .setColor(0x51CF66)
        .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [row] });
}

/**
 * Xử lý khi user chọn model từ menu (gọi từ interactionCreate)
 */
export async function handleBlockAgentMenu(interaction) {
    if (!SelfDevService.isOwner(interaction.user.id)) {
        return interaction.reply({
            content: '🔒 Bạn không có quyền thực hiện thao tác này!',
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferUpdate();

    const customId = interaction.customId;
    const selectedValues = interaction.values;

    if (customId === 'blockagent_block_menu') {
        // Block các model đã chọn (CHỈ CHO AGENT)
        const results = [];
        for (const value of selectedValues) {
            // Format: blockagent_<modelId>_<duration>
            const parts = value.replace('blockagent_', '').split('_');
            const durationKey = parts.pop();
            const modelId = parts.join('_');

            const cooldownMs = BLOCK_DURATIONS[durationKey] || BLOCK_DURATIONS['24h'];

            await geminiModelService.blockAgentModel(
                modelId,
                `MANUAL_BLOCK (by owner, ${DURATION_LABELS[durationKey] || '24h'})`,
                cooldownMs
            );
            results.push(`🔴 \`${modelId}\` — blocked Agent ${DURATION_LABELS[durationKey] || '24h'}`);
        }

        const embed = new EmbedBuilder()
            .setTitle('🚫 Đã Block Model(s) cho Agent')
            .setDescription(
                results.join('\n') +
                '\n\n💡 *Chat thông thường của Dolia vẫn hoạt động bình thường, không bị ảnh hưởng.*'
            )
            .setColor(0xFF6B6B)
            .setFooter({ text: `${results.length} model đã bị block cho Agent` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
    }

    else if (customId === 'blockagent_unblock_menu') {
        // Unblock các model đã chọn (CHO AGENT)
        const results = [];
        for (const value of selectedValues) {
            // Format: blockagent_unblock_<modelId>
            const modelId = value.replace('blockagent_unblock_', '');

            await geminiModelService.unblockAgentModel(modelId);
            results.push(`🟢 \`${modelId}\` — unblocked cho Agent`);
        }

        const embed = new EmbedBuilder()
            .setTitle('✅ Đã Unblock Model(s) cho Agent')
            .setDescription(results.join('\n'))
            .setColor(0x51CF66)
            .setFooter({ text: `${results.length} model đã được mở lại cho Agent` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
    }
}
