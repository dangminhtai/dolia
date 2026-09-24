import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { automationAction, automationQuery } from '../../services/automationService.js';
import { renderAutomationPanel } from '../../services/automationPanelService.js';
import { t } from '../../services/i18nService.js';

const actions = [
    ['panel', t('automation.command.choices.panel')], ['create', t('automation.command.choices.create')],
    ['update', t('automation.command.choices.update')], ['show', t('automation.command.choices.show')],
    ['enable', t('automation.command.choices.enable')], ['disable', t('automation.command.choices.disable')],
    ['delete', t('automation.command.choices.delete')], ['run_once', t('automation.command.choices.run_once')]
];

export default {
    data: new SlashCommandBuilder().setName('automation').setDescription(t('automation.command.description'))
        .addStringOption(option => option.setName('action').setDescription(t('automation.command.action')).setRequired(true)
            .addChoices(...actions.map(([name, description]) => ({ name: description, value: name }))))
        .addStringOption(option => option.setName('rule_id').setDescription(t('automation.command.rule_id')))
        .addStringOption(option => option.setName('spec').setDescription(t('automation.command.spec'))),
    async execute(interaction) {
        const action = interaction.options.getString('action', true);
        if (action === 'panel') {
            await interaction.reply({ ...(await renderAutomationPanel(interaction)), flags: MessageFlags.Ephemeral });
            return;
        }
        const args = { interaction, action: action === 'show' ? 'get' : action, rule_id: interaction.options.getString('rule_id') };
        if (action === 'create' || action === 'update') {
            try { args.spec = JSON.parse(interaction.options.getString('spec') || ''); }
            catch { await interaction.reply({ content: t('automation.errors.invalid_json'), flags: MessageFlags.Ephemeral }); return; }
        }
        const result = action === 'show' ? await automationQuery(args) : await automationAction(args);
        const detail = result.rule ? `\n\`ID: ${result.rule.ruleId}\` · ${result.rule.status} · r${result.rule.revision}` : '';
        await interaction.reply({ content: `${result.reply}${detail}`.slice(0, 2000), flags: MessageFlags.Ephemeral });
    }
};
