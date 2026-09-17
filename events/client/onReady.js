import { t as tr } from '../../services/i18nService.js';
import { Events } from 'discord.js';
import { initLavalink } from '../../utils/LavalinkManager.js';

export default (client) => {
    client.once(Events.ClientReady, () => {
        console.log(tr('logs.onready.log_bot_da_dang_nhap_duoi_ten', { tag: client.user.tag }));
        initLavalink(client);
    });
};
