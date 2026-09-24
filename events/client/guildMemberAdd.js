import { Events } from 'discord.js';
import { handleMemberAutomation } from '../../services/automationEventRouter.js';
import { t } from '../../services/i18nService.js';

export default client => {
    client.on(Events.GuildMemberAdd, member => {
        void handleMemberAutomation(member).catch(error => {
            console.error(t('automation.logs.event_failed', { type: 'guildMemberAdd', message: error.message }));
        });
    });
};
