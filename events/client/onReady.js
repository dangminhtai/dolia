import { Events } from 'discord.js';
import { initLavalink } from '../../utils/LavalinkManager.js';
import { initMorningGreeting } from '../../utils/morningGreeting.js';

export default (client) => {
    client.once(Events.ClientReady, () => {
        console.log(`Bot đã đăng nhập dưới tên ${client.user.tag}`);
        initLavalink(client);
        initMorningGreeting(client);
    });

};
