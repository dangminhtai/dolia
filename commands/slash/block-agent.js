import { t as tr } from '../../services/i18nService.js';
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
    '1h': tr('commands.block_agent.1h_1_gio'),
    '6h': tr('commands.block_agent.6h_6_gio'),
    '24h': tr('commands.block_agent.24h_24_gio'),
    '7d': tr('commands.block_agent.7d_7_ngay'),
    'permanent': tr('commands.block_agent.permanent_vinh_vien')
};

export default {
    data: new SlashCommandBuilder()
        .setName('block-agent')
        .setDescription(tr('commands.block_agent.setdescription_quan_ly_block_unblock_model_ai_cho'))
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addStringOption(option =>
            option.setName('action')
                .setDescription(tr('commands.block_agent.setdescription_hanh_dong_muon_thuc_hien'))
                .setRequired(true)
                .addChoices(
                    { name: tr('commands.block_agent.name_block_model_s'), value: 'block' },
                    { name: tr('commands.block_agent.name_unblock_model_s'), value: 'unblock' },
                    { name: tr('commands.block_agent.name_xem_trang_thai'), value: 'status' }
                )
        )
        .addStringOption(option =>
            option.setName('duration')
                .setDescription(tr('commands.block_agent.setdescription_thoi_gian_block_mac_dinh_24h'))
                .setRequired(false)
                .addChoices(
                    { name: tr('commands.block_agent.name_1_gio'), value: '1h' },
                    { name: tr('commands.block_agent.name_6_gio'), value: '6h' },
                    { name: tr('commands.block_agent.name_24_gio_mac_dinh'), value: '24h' },
                    { name: tr('commands.block_agent.name_7_ngay'), value: '7d' },
                    { name: tr('commands.block_agent.name_vinh_vien'), value: 'permanent' }
                )
        ),

    async execute(interaction) {
        // Owner check
        if (!SelfDevService.isOwner(interaction.user.id)) {
            return interaction.reply({
                content: tr('commands.block_agent.content_chi_co_chu_nhan_moi_duoc_quan'),
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
        const statusIcon = isBlocked ? tr('commands.block_agent.status_blocked') : tr('commands.block_agent.status_available');
        const typeIcon = m.type === 'flash' ? tr('commands.block_agent.type_flash_icon') : tr('commands.block_agent.type_lite_icon');

        let blockInfo = '';
        if (isBlocked) {
            const remaining = m.agentBlockedUntil - now;
            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);
            blockInfo = tr('messages.block_agent.text_block_agent_con_hm', { hours: hours, minutes: minutes, value: m.agentBlockReason || 'N/A' });
        }

        return `${statusIcon} ${typeIcon} \`${m.modelId}\`${blockInfo}`;
    });

    const blockedCount = allModels.filter(m => m.agentBlockedUntil && m.agentBlockedUntil > now).length;

    const embed = new EmbedBuilder()
        .setTitle(tr('commands.block_agent.settitle_trang_thai_model_agent_antigravity_selfdev'))
        .setDescription(
            tr('commands.block_agent.setdescription_luu_y_trang_thai_block_o_day', { value: (lines.join('\n') || tr('messages.block_agent.text_khong_co_model_nao_trong_database')) })
        )
        .setColor(blockedCount > 0 ? 0xFF6B6B : 0x51CF66)
        .setFooter({ text: tr('commands.block_agent.text_model_dang_bi_block_cho_agent', { length: allModels.length, blockedCount: blockedCount }) })
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
            content: tr('commands.block_agent.content_tat_ca_model_deu_dang_bi_block')
        });
    }

    const options = availableModels.slice(0, 25).map(m => {
        const typeLabel = m.type === 'flash' ? tr('commands.block_agent.text_flash') : tr('commands.block_agent.text_lite');
        const emoji = (m.type === 'flash'
            ? tr('commands.block_agent.type_flash_icon')
            : tr('commands.block_agent.type_lite_icon'))?.trim();

        return {
            label: m.modelId,
            description: tr('commands.block_agent.description_v', { typeLabel: typeLabel, version: m.version }),
            value: `blockagent_${m.modelId}_${duration}`,
            ...(emoji ? { emoji } : {})
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('blockagent_block_menu')
        .setPlaceholder(tr('commands.block_agent.setplaceholder_chon_model_de_block_agent', { value: DURATION_LABELS[duration] }))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle(tr('commands.block_agent.settitle_block_model_cho_agent_antigravity_selfdev'))
        .setDescription(
            tr('commands.block_agent.setdescription_chon_mot_hoac_nhieu_model_de_block', { value: DURATION_LABELS[duration] })
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
            content: tr('commands.block_agent.content_khong_co_model_nao_dang_bi_block')
        });
    }

    const options = blockedModels.slice(0, 25).map(m => {
        const remaining = m.agentBlockedUntil - now;
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const emoji = tr('commands.block_agent.emoji_emoji')?.trim();

        return {
            label: m.modelId,
            description: tr('commands.block_agent.description_con_hm', { hours: hours, minutes: minutes, value: m.agentBlockReason || 'N/A' }),
            value: `blockagent_unblock_${m.modelId}`,
            ...(emoji ? { emoji } : {})
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('blockagent_unblock_menu')
        .setPlaceholder(tr('commands.block_agent.setplaceholder_chon_model_de_unblock_cho_agent'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle(tr('commands.block_agent.settitle_unblock_model_cho_agent'))
        .setDescription(
            tr('commands.block_agent.setdescription_chon_mot_hoac_nhieu_model_de_go')
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
            content: tr('commands.block_agent.content_ban_khong_co_quyen_thuc_hien_thao'),
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
            results.push(tr('messages.block_agent.text_blocked_agent', { modelId: modelId, value: DURATION_LABELS[durationKey] || '24h' }));
        }

        const embed = new EmbedBuilder()
            .setTitle(tr('commands.block_agent.settitle_da_block_model_s_cho_agent'))
            .setDescription(
                tr('commands.block_agent.setdescription_chat_thong_thuong_cua_dolia_van_hoat', { value: results.join('\n') })
            )
            .setColor(0xFF6B6B)
            .setFooter({ text: tr('commands.block_agent.text_model_da_bi_block_cho_agent', { length: results.length }) })
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
            results.push(tr('messages.block_agent.text_unblocked_cho_agent', { modelId: modelId }));
        }

        const embed = new EmbedBuilder()
            .setTitle(tr('commands.block_agent.settitle_da_unblock_model_s_cho_agent'))
            .setDescription(results.join('\n'))
            .setColor(0x51CF66)
            .setFooter({ text: tr('commands.block_agent.text_model_da_duoc_mo_lai_cho_agent', { length: results.length }) })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
    }
}
