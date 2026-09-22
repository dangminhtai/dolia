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

const BLOCK_DURATIONS = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    permanent: 365 * 24 * 60 * 60 * 1000
};

const durationLabel = key => tr(`commands.block_model.duration_${key}`);
const typeLabel = model => model.type === 'flash' ? tr('commands.block_model.type_flash') : tr('commands.block_model.type_lite');
const typeEmoji = model => (model.type === 'flash'
    ? tr('commands.block_model.type_flash_icon')
    : tr('commands.block_model.type_lite_icon'))?.trim();

export default {
    data: new SlashCommandBuilder()
        .setName('block-model')
        .setDescription(tr('commands.block_model.description'))
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addStringOption(option => option
            .setName('action')
            .setDescription(tr('commands.block_model.action_description'))
            .setRequired(true)
            .addChoices(
                { name: tr('commands.block_model.action_block'), value: 'block' },
                { name: tr('commands.block_model.action_unblock'), value: 'unblock' },
                { name: tr('commands.block_model.action_status'), value: 'status' }
            ))
        .addStringOption(option => option
            .setName('duration')
            .setDescription(tr('commands.block_model.duration_description'))
            .setRequired(false)
            .addChoices(
                { name: durationLabel('1h'), value: '1h' },
                { name: durationLabel('6h'), value: '6h' },
                { name: durationLabel('24h'), value: '24h' },
                { name: durationLabel('7d'), value: '7d' },
                { name: durationLabel('permanent'), value: 'permanent' }
            )),

    async execute(interaction) {
        if (!SelfDevService.isOwner(interaction.user.id)) {
            return interaction.reply({ content: tr('commands.block_model.owner_only'), flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await geminiModelService.syncBlockCache();
        const models = await GeminiModel.find({ isActive: true })
            .sort({ type: 1, versionMajor: -1, versionMinor: -1, versionPatch: -1 })
            .lean();
        const action = interaction.options.getString('action');
        if (action === 'status') return showStatus(interaction, models);
        if (action === 'block') return showBlockMenu(interaction, models, interaction.options.getString('duration') || '24h');
        return showUnblockMenu(interaction, models);
    }
};

async function showStatus(interaction, models) {
    const now = new Date();
    const lines = models.map(model => {
        const blocked = model.blockedUntil && model.blockedUntil > now
            && String(model.blockReason || '').startsWith('MANUAL_CHAT_BLOCK');
        const icon = blocked ? tr('commands.block_model.status_blocked') : tr('commands.block_model.status_available');
        let detail = '';
        if (blocked) {
            const remaining = model.blockedUntil - now;
            detail = tr('commands.block_model.remaining', {
                hours: Math.floor(remaining / 3600000),
                minutes: Math.floor((remaining % 3600000) / 60000)
            });
        }
        return `${icon} \`${model.modelId}\`${detail}`;
    });
    const blockedCount = models.filter(model => model.blockedUntil && model.blockedUntil > now
        && String(model.blockReason || '').startsWith('MANUAL_CHAT_BLOCK')).length;
    const embed = new EmbedBuilder()
        .setTitle(tr('commands.block_model.status_title'))
        .setDescription(lines.join('\n') || tr('commands.block_model.no_models'))
        .setColor(blockedCount ? 0xFF6B6B : 0x51CF66)
        .setFooter({ text: tr('commands.block_model.status_footer', { total: models.length, blocked: blockedCount }) })
        .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
}

function modelOptions(models, valueFor, descriptionFor) {
    return models.slice(0, 25).map(model => {
        const emoji = typeEmoji(model);
        return {
            label: model.modelId,
            description: descriptionFor(model),
            value: valueFor(model),
            ...(emoji ? { emoji } : {})
        };
    });
}

async function showBlockMenu(interaction, models, duration) {
    const now = new Date();
    const available = models.filter(model => !(model.blockedUntil && model.blockedUntil > now
        && String(model.blockReason || '').startsWith('MANUAL_CHAT_BLOCK')));
    if (!available.length) return interaction.editReply({ content: tr('commands.block_model.all_blocked') });
    const options = modelOptions(
        available,
        model => `blockchat|block|${duration}|${model.modelId}`,
        model => tr('commands.block_model.model_description', { type: typeLabel(model), version: model.version })
    );
    const menu = new StringSelectMenuBuilder()
        .setCustomId('blockchat_block_menu')
        .setPlaceholder(tr('commands.block_model.block_placeholder', { duration: durationLabel(duration) }))
        .setMinValues(1)
        .setMaxValues(options.length)
        .addOptions(options);
    const embed = new EmbedBuilder()
        .setTitle(tr('commands.block_model.block_title'))
        .setDescription(tr('commands.block_model.block_description', { duration: durationLabel(duration) }))
        .setColor(0xFF6B6B)
        .setTimestamp();
    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

async function showUnblockMenu(interaction, models) {
    const now = new Date();
    const blocked = models.filter(model => model.blockedUntil && model.blockedUntil > now
        && String(model.blockReason || '').startsWith('MANUAL_CHAT_BLOCK'));
    if (!blocked.length) return interaction.editReply({ content: tr('commands.block_model.none_blocked') });
    const options = modelOptions(
        blocked,
        model => `blockchat|unblock|${model.modelId}`,
        model => {
            const remaining = model.blockedUntil - now;
            return tr('commands.block_model.remaining_plain', {
                hours: Math.floor(remaining / 3600000),
                minutes: Math.floor((remaining % 3600000) / 60000)
            });
        }
    );
    const menu = new StringSelectMenuBuilder()
        .setCustomId('blockchat_unblock_menu')
        .setPlaceholder(tr('commands.block_model.unblock_placeholder'))
        .setMinValues(1)
        .setMaxValues(options.length)
        .addOptions(options);
    const embed = new EmbedBuilder()
        .setTitle(tr('commands.block_model.unblock_title'))
        .setDescription(tr('commands.block_model.unblock_description'))
        .setColor(0x51CF66)
        .setTimestamp();
    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

export async function handleBlockModelMenu(interaction) {
    if (!SelfDevService.isOwner(interaction.user.id)) {
        return interaction.reply({ content: tr('commands.block_model.owner_only'), flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    const results = [];
    for (const value of interaction.values) {
        const parts = value.split('|');
        if (parts[0] !== 'blockchat') continue;
        if (parts[1] === 'block') {
            const duration = parts[2];
            const modelId = parts.slice(3).join('|');
            await geminiModelService.blockChatModel(
                modelId,
                `MANUAL_CHAT_BLOCK (by owner, ${durationLabel(duration)})`,
                BLOCK_DURATIONS[duration] || BLOCK_DURATIONS['24h']
            );
            results.push(tr('commands.block_model.blocked_item', { modelId, duration: durationLabel(duration) }));
        } else if (parts[1] === 'unblock') {
            const modelId = parts.slice(2).join('|');
            await geminiModelService.unblockChatModel(modelId);
            results.push(tr('commands.block_model.unblocked_item', { modelId }));
        }
    }
    const blocked = interaction.customId === 'blockchat_block_menu';
    const embed = new EmbedBuilder()
        .setTitle(tr(blocked ? 'commands.block_model.block_done_title' : 'commands.block_model.unblock_done_title'))
        .setDescription(results.join('\n'))
        .setColor(blocked ? 0xFF6B6B : 0x51CF66)
        .setFooter({ text: tr('commands.block_model.changed_count', { count: results.length }) })
        .setTimestamp();
    return interaction.editReply({ embeds: [embed], components: [] });
}
