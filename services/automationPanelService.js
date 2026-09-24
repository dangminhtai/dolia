import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import AutomationRule from '../models/AutomationRule.js';
import { automationAction, automationQuery } from './automationService.js';
import { t } from './i18nService.js';

const PAGE_SIZE = 5;

const context = interaction => ({
    interaction, user: interaction.user, guild: interaction.guild,
    channel: interaction.channel, member: interaction.member
});

function parseId(value) {
    const [, action, ownerId, page = '0'] = String(value || '').split(':');
    return { action, ownerId, page: Math.max(0, Number(page) || 0) };
}

function input(id, label, { paragraph = false, maxLength = 100, placeholder = '' } = {}) {
    const component = new TextInputBuilder().setCustomId(id).setLabel(label)
        .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setMaxLength(maxLength).setRequired(true);
    if (placeholder) component.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(component);
}

export async function renderAutomationPanel(interaction, page = 0) {
    const result = await automationQuery({ action: 'list', limit: 50, ...context(interaction) });
    const rules = result.rules || [];
    const pages = Math.max(1, Math.ceil(rules.length / PAGE_SIZE));
    const safePage = Math.min(page, pages - 1);
    const items = rules.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    const description = items.length ? items.map(rule => t('automation.panel.item', {
        name: rule.name, id: rule.ruleId, trigger: rule.trigger.type,
        status: rule.status, revision: rule.revision,
        nextRun: rule.nextRunAt ? new Date(rule.nextRunAt).toLocaleString('vi-VN') : t('automation.panel.no_next_run')
    })).join('\n\n') : t('automation.panel.empty');
    const owner = interaction.user.id;
    const embed = new EmbedBuilder().setTitle(t('automation.panel.title')).setDescription(description.slice(0, 4096))
        .setFooter({ text: t('automation.panel.footer', { page: safePage + 1, pages, total: rules.length }) });
    const navigation = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`automation:prev:${owner}:${safePage}`).setLabel(t('automation.panel.previous')).setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
        new ButtonBuilder().setCustomId(`automation:next:${owner}:${safePage}`).setLabel(t('automation.panel.next')).setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pages - 1),
        new ButtonBuilder().setCustomId(`automation:refresh:${owner}:${safePage}`).setLabel(t('automation.panel.refresh')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`automation:create:${owner}:${safePage}`).setLabel(t('automation.panel.create')).setStyle(ButtonStyle.Success)
    );
    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`automation:enable:${owner}:${safePage}`).setLabel(t('automation.panel.enable')).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`automation:disable:${owner}:${safePage}`).setLabel(t('automation.panel.disable')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`automation:edit:${owner}:${safePage}`).setLabel(t('automation.panel.edit')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`automation:history:${owner}:${safePage}`).setLabel(t('automation.panel.history')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`automation:delete:${owner}:${safePage}`).setLabel(t('automation.panel.delete')).setStyle(ButtonStyle.Danger)
    );
    return { embeds: [embed], components: [navigation, controls] };
}

function ruleModal(action, ownerId, page) {
    return new ModalBuilder().setCustomId(`automation:${action}_submit:${ownerId}:${page}`)
        .setTitle(t(`automation.modal.${action}_title`))
        .addComponents(input('rule_id', t('automation.modal.rule_id'), { maxLength: 30 }));
}

function createModal(ownerId, page) {
    return new ModalBuilder().setCustomId(`automation:create_submit:${ownerId}:${page}`)
        .setTitle(t('automation.modal.create_title'))
        .addComponents(input('spec', t('automation.modal.spec'), {
            paragraph: true, maxLength: 4000, placeholder: t('automation.modal.spec_hint')
        }));
}

function editModal(ownerId, page) {
    return new ModalBuilder().setCustomId(`automation:edit_submit:${ownerId}:${page}`)
        .setTitle(t('automation.modal.edit_title')).addComponents(
            input('rule_id', t('automation.modal.rule_id'), { maxLength: 30 }),
            input('spec', t('automation.modal.spec'), { paragraph: true, maxLength: 4000, placeholder: t('automation.modal.spec_hint') })
        );
}

export async function handleAutomationInteraction(interaction) {
    if (!interaction.customId?.startsWith('automation:')) return false;
    const { action, ownerId, page } = parseId(interaction.customId);
    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: t('automation.errors.panel_owner'), ephemeral: true });
        return true;
    }
    if (interaction.isButton()) {
        if (['prev', 'next', 'refresh'].includes(action)) {
            const delta = action === 'prev' ? -1 : action === 'next' ? 1 : 0;
            await interaction.update(await renderAutomationPanel(interaction, page + delta));
        } else if (action === 'create') {
            await interaction.showModal(createModal(ownerId, page));
        } else if (action === 'edit') {
            await interaction.showModal(editModal(ownerId, page));
        } else if (['enable', 'disable', 'delete', 'history'].includes(action)) {
            await interaction.showModal(ruleModal(action, ownerId, page));
        }
        return true;
    }
    if (interaction.isModalSubmit()) {
        if (action === 'create_submit') {
            let spec;
            try { spec = JSON.parse(interaction.fields.getTextInputValue('spec')); }
            catch { throw Object.assign(new Error(t('automation.errors.invalid_json')), { code: 'INVALID_JSON' }); }
            const result = await automationAction({ action: 'create', spec, ...context(interaction) });
            await interaction.reply({ content: result.reply, ephemeral: true });
        } else if (action === 'edit_submit') {
            let spec;
            try { spec = JSON.parse(interaction.fields.getTextInputValue('spec')); }
            catch { throw Object.assign(new Error(t('automation.errors.invalid_json')), { code: 'INVALID_JSON' }); }
            const result = await automationAction({
                action: 'update', rule_id: interaction.fields.getTextInputValue('rule_id').trim(), spec, ...context(interaction)
            });
            await interaction.reply({ content: result.reply, ephemeral: true });
        } else {
            const baseAction = action.replace('_submit', '');
            const ruleId = interaction.fields.getTextInputValue('rule_id').trim();
            if (baseAction === 'history') {
                const result = await automationQuery({ action: 'history', rule_id: ruleId, limit: 10, ...context(interaction) });
                const text = result.history.length ? result.history.map(item => t('automation.history.item', {
                    status: item.status, date: new Date(item.startedAt).toLocaleString('vi-VN'), error: item.errorCode || '-'
                })).join('\n') : t('automation.history.empty');
                await interaction.reply({ content: text.slice(0, 2000), ephemeral: true });
            } else {
                const result = await automationAction({ action: baseAction, rule_id: ruleId, ...context(interaction) });
                await interaction.reply({ content: result.reply, ephemeral: true });
            }
        }
        return true;
    }
    return true;
}
