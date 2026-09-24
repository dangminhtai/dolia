import { Events } from 'discord.js';
import { handleAutoModAutomation } from '../../services/automationEventRouter.js';
import { t } from '../../services/i18nService.js';

export default client => {
    client.on(Events.AutoModerationActionExecution, event => {
        void handleAutoModAutomation(event).catch(error => {
            console.error(t('automation.logs.event_failed', { type: 'autoModerationActionExecution', message: error.message }));
        });
    });
};
