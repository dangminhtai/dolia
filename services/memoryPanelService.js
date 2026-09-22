import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import Memory from '../models/Memory.js';
import {
    actOnMemory, exportVisibleMemories, getMemoryHistory, visibilityFilter
} from './memoryService.js';
import { t } from './i18nService.js';

const PAGE_SIZE = 5;

function ctx(interaction) {
    return {
        user: interaction.user,
        guild: interaction.guild,
        channel: interaction.channel,
        member: interaction.member
    };
}

function parseId(customId) {
    const [prefix, action, ownerId, page = '0'] = String(customId || '').split(':');
    return { prefix, action, ownerId, page: Math.max(0, Number(page) || 0) };
}

function rowInput(id, label, { style = TextInputStyle.Short, required = true, value, placeholder, maxLength } = {}) {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    if (value) input.setValue(String(value).slice(0, maxLength || 4000));
    if (placeholder) input.setPlaceholder(placeholder);
    if (maxLength) input.setMaxLength(maxLength);
    return new ActionRowBuilder().addComponents(input);
}

export async function renderMemoryPanel(interaction, page = 0) {
    const context = ctx(interaction);
    const filter = visibilityFilter({
        userId: interaction.user.id,
        guildId: interaction.guildId || null,
        channelId: interaction.channelId || null
    });
    const total = await Memory.countDocuments(filter);
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(Math.max(0, page), pageCount - 1);
    const memories = await Memory.find(filter).sort({ updatedAt: -1 })
        .skip(safePage * PAGE_SIZE).limit(PAGE_SIZE).lean();
    const description = memories.length
        ? memories.map((memory, index) => {
            const position = safePage * PAGE_SIZE + index + 1;
            return t('memory.panel.item', {
                position,
                scope: memory.scope,
                kind: memory.kind,
                text: memory.text,
                id: String(memory._id),
                version: memory.version
            });
        }).join('\n\n')
        : t('memory.panel.empty');
    const embed = new EmbedBuilder()
        .setTitle(t('memory.panel.title'))
        .setDescription(description.slice(0, 4096))
        .setFooter({ text: t('memory.panel.footer', { page: safePage + 1, pages: pageCount, total }) });
    const owner = interaction.user.id;
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`memory:prev:${owner}:${safePage}`).setLabel(t('memory.panel.previous')).setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
        new ButtonBuilder().setCustomId(`memory:next:${owner}:${safePage}`).setLabel(t('memory.panel.next')).setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pageCount - 1),
        new ButtonBuilder().setCustomId(`memory:export:${owner}:${safePage}`).setLabel(t('memory.panel.export')).setStyle(ButtonStyle.Secondary)
    );
    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`memory:add:${owner}:${safePage}`).setLabel(t('memory.panel.add')).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`memory:edit:${owner}:${safePage}`).setLabel(t('memory.panel.edit')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`memory:delete:${owner}:${safePage}`).setLabel(t('memory.panel.delete')).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`memory:history:${owner}:${safePage}`).setLabel(t('memory.panel.history')).setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [nav, actions] };
}

function addModal(ownerId, page) {
    return new ModalBuilder().setCustomId(`memory:add_submit:${ownerId}:${page}`).setTitle(t('memory.modal.add_title')).addComponents(
        rowInput('text', t('memory.modal.text'), { style: TextInputStyle.Paragraph, maxLength: 1000 }),
        rowInput('key', t('memory.modal.key'), { placeholder: t('memory.modal.key_hint'), maxLength: 120 }),
        rowInput('kind', t('memory.modal.kind'), { value: 'fact', maxLength: 20 }),
        rowInput('scope', t('memory.modal.scope'), { value: 'user_private', maxLength: 20 }),
        rowInput('tags', t('memory.modal.tags'), { required: false, maxLength: 150 })
    );
}

function editModal(ownerId, page) {
    return new ModalBuilder().setCustomId(`memory:edit_submit:${ownerId}:${page}`).setTitle(t('memory.modal.edit_title')).addComponents(
        rowInput('memory_id', t('memory.modal.id'), { maxLength: 24 }),
        rowInput('text', t('memory.modal.new_text'), { style: TextInputStyle.Paragraph, maxLength: 1000 })
    );
}

function idModal(action, ownerId, page) {
    return new ModalBuilder().setCustomId(`memory:${action}_submit:${ownerId}:${page}`)
        .setTitle(t(`memory.modal.${action}_title`))
        .addComponents(rowInput('memory_id', t('memory.modal.id'), { maxLength: 24 }));
}

export async function handleMemoryInteraction(interaction) {
    if (!interaction.customId?.startsWith('memory:')) return false;
    const { action, ownerId, page } = parseId(interaction.customId);
    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: t('memory.errors.panel_owner'), ephemeral: true });
        return true;
    }

    if (interaction.isButton()) {
        if (action === 'prev' || action === 'next') {
            await interaction.update(await renderMemoryPanel(interaction, page + (action === 'next' ? 1 : -1)));
        } else if (action === 'add') {
            await interaction.showModal(addModal(ownerId, page));
        } else if (action === 'edit') {
            await interaction.showModal(editModal(ownerId, page));
        } else if (action === 'delete' || action === 'history') {
            await interaction.showModal(idModal(action, ownerId, page));
        } else if (action === 'export') {
            const data = await exportVisibleMemories(ctx(interaction));
            await interaction.reply({
                content: t('memory.panel.exported', { count: data.length }),
                files: [{ attachment: Buffer.from(JSON.stringify(data, null, 2), 'utf8'), name: 'dolia-memory.json' }],
                ephemeral: true
            });
        }
        return true;
    }

    if (interaction.isModalSubmit()) {
        if (action === 'add_submit') {
            const result = await actOnMemory({
                action: 'create', source: 'manual_ui',
                text: interaction.fields.getTextInputValue('text'),
                key: interaction.fields.getTextInputValue('key'),
                kind: interaction.fields.getTextInputValue('kind').trim().toLowerCase(),
                scope: interaction.fields.getTextInputValue('scope').trim().toLowerCase(),
                tags: interaction.fields.getTextInputValue('tags').split(',').map(value => value.trim()),
                ...ctx(interaction)
            });
            await interaction.reply({ content: result.reply, ephemeral: true });
        } else if (action === 'edit_submit' || action === 'delete_submit') {
            const result = await actOnMemory({
                action: action === 'edit_submit' ? 'update' : 'delete',
                memory_id: interaction.fields.getTextInputValue('memory_id').trim(),
                text: action === 'edit_submit' ? interaction.fields.getTextInputValue('text') : undefined,
                ...ctx(interaction)
            });
            await interaction.reply({ content: result.reply, ephemeral: true });
        } else if (action === 'history_submit') {
            const memoryId = interaction.fields.getTextInputValue('memory_id').trim();
            const history = await getMemoryHistory(memoryId, ctx(interaction));
            const content = history.length
                ? history.map(item => t('memory.history.item', {
                    version: item.version,
                    action: item.action,
                    text: item.snapshot?.text || '',
                    date: new Date(item.createdAt).toLocaleString('vi-VN')
                })).join('\n')
                : t('memory.history.empty');
            await interaction.reply({ content: content.slice(0, 2000), ephemeral: true });
        }
        return true;
    }
    return true;
}
