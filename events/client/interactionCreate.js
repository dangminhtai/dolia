import { t as tr } from '../../services/i18nService.js';
import { Events, MessageFlags, PermissionFlagsBits } from "discord.js";
import { handleBlockAgentMenu } from '../../commands/slash/block-agent.js';
import { handleBlockModelMenu } from '../../commands/slash/block-model.js';

// Music Panel Imports
import PanelState from '../../models/PanelState.js';
import { renderMusicPanel } from '../../utils/PanelRenderer.js';
import { poru } from '../../utils/LavalinkManager.js';
import { applyAudioSettings } from '../../utils/AudioController.js';
import GuildMusicQueue from '../../models/GuildMusicQueue.js';
import UserPlaylist from '../../models/UserPlaylist.js';
import RadioSong from '../../models/RadioSong.js';
import MusicSetting from '../../models/MusicSetting.js'; // Added missing import
import { executePlay } from '../../utils/PlayUtils.js';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import GeminiLyrics from '../../class/GeminiLyrics.js';
import { sendSafeMessage } from '../../utils/messageHelper.js';
import { t } from '../../services/i18nService.js';
import { getUserMusicSource, isFailed, isEmpty, isPlaylist, isSuccess } from '../../utils/lavalinkHelper.js';
import { handleMemoryInteraction } from '../../services/memoryPanelService.js';

function parseOwnedMusicCustomId(rawCustomId) {
    const raw = String(rawCustomId || '');
    const separator = raw.lastIndexOf(':');
    if (separator <= 0) return { actionId: raw, ownerId: null };
    return { actionId: raw.slice(0, separator), ownerId: raw.slice(separator + 1) || null };
}

const ADMIN_RADIO_ACTIONS = new Set([
    'music_radio_add_current',
    'music_radio_add_query',
    'music_modal_radio_add',
    'music_radio_remove',
    'music_modal_radio_remove'
]);

export default (client) => {
    client.on(Events.InteractionCreate, async interaction => {
        if (interaction.customId?.startsWith('memory:')) {
            try {
                await handleMemoryInteraction(interaction);
            } catch (error) {
                console.error(tr('logs.interactioncreate.error_memory_panel'), error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: t('memory.errors.generic'), flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            }
            return;
        }

        // --- 0.1 XỬ LÝ MUSIC PANEL (BẤT TỬ) ---
        if (interaction.customId?.startsWith('music_')) {
            try {
                const { actionId: customId, ownerId } = parseOwnedMusicCustomId(interaction.customId);
                if (!ownerId || interaction.user.id !== ownerId) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: t('common.not_your_menu'), flags: MessageFlags.Ephemeral });
                    }
                    return;
                }
                if (ADMIN_RADIO_ACTIONS.has(customId)
                    && !interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) {
                    await interaction.reply({ content: t('errors.no_permission'), flags: MessageFlags.Ephemeral });
                    return;
                }

                // ================== A. XỬ LÝ MODAL SUBMIT ==================
                if (interaction.isModalSubmit()) {
                    const guildId = interaction.guild.id;
                    // Defer ephemeral ngay lập tức để tránh timeout
                    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });

                    if (customId === 'music_modal_pl_create') {
                        const name = interaction.fields.getTextInputValue('pl_name_input');
                        await UserPlaylist.create({ userId: interaction.user.id, name: name, tracks: [] });
                        await interaction.editReply({ content: t('music.playlist.created', { name }) });

                        // Refresh UI Panel (nếu tìm được tin nhắn gốc)
                        const state = await PanelState.findOne({ messageId: interaction.message?.id, ownerId });
                        if (state) {
                            const newPayload = await renderMusicPanel(guildId, state, interaction.user.id);
                            if (interaction.message) await interaction.message.edit(newPayload).catch(() => { });
                        }
                    }

                    else if (customId === 'music_modal_queue_add_priority') {
                        const query = interaction.fields.getTextInputValue('q_url_input');
                        // Gọi hàm dùng chung (isPriority = true)
                        const result = await executePlay(interaction, query, true);

                        // Reply kết quả
                        await interaction.editReply(result.message);

                        // Refresh UI
                        const state = await PanelState.findOne({ messageId: interaction.message?.id, ownerId });
                        if (state) {
                            const newPayload = await renderMusicPanel(guildId, state, interaction.user.id);
                            if (interaction.message) await interaction.message.edit(newPayload).catch(() => { });
                        }
                    }

                    else if (customId === 'music_modal_pl_add_query') {
                        const query = interaction.fields.getTextInputValue('pl_query_input');
                        // Resolve
                        const isUrl = /^https?:\/\//.test(query);
                        let res;
                        try {
                            const source = isUrl ? null : await getUserMusicSource(interaction.user.id);
                            res = await poru.resolve({ query: query, source: source, requester: interaction.user });
                        } catch (e) {
                            return interaction.editReply(t('music.errors.connection_error_search'));
                        }

                        if (!res || isFailed(res.loadType) || isEmpty(res.loadType, res.tracks)) {
                            return interaction.editReply(t('music.errors.no_matches'));
                        }

                        // Get Playlist ID from State (state đã được tìm ở trên, nhưng cần load lại để chắc chắn)
                        const state = await PanelState.findOne({ messageId: interaction.message?.id, ownerId });
                        if (!state || !state.selectedPlaylistId) {
                            return interaction.editReply(t('music.playlist.no_selected'));
                        }

                        const pl = await UserPlaylist.findOne({ _id: state.selectedPlaylistId, userId: ownerId });
                        if (!pl) return interaction.editReply(t('music.playlist.not_found'));

                        let count = 0;
                        if (isPlaylist(res.loadType)) {
                            for (const t of res.tracks) {
                                pl.tracks.push({ title: t.info.title, url: t.info.uri, author: t.info.author, duration: t.info.length });
                            }
                            count = res.tracks.length;
                        } else {
                            const t = res.tracks[0];
                            pl.tracks.push({ title: t.info.title, url: t.info.uri, author: t.info.author, duration: t.info.length });
                            count = 1;
                        }
                        await pl.save();
                        await interaction.editReply(t('music.playlist.added_tracks', { count, name: pl.name }));

                        // Refresh UI
                        if (state) {
                            const newPayload = await renderMusicPanel(guildId, state, interaction.user.id);
                            if (interaction.message) await interaction.message.edit(newPayload).catch(() => { });
                        }
                    }

                    else if (customId === 'music_modal_radio_add') {
                        const query = interaction.fields.getTextInputValue('radio_query_input');
                        const isUrl = /^https?:\/\//.test(query);
                        let res;
                        try {
                            res = await poru.resolve({ query: query, source: isUrl ? null : 'ytsearch', requester: interaction.user });
                        } catch (e) { return interaction.editReply(t('music.errors.connection_error')); }

                        if (!isSuccess(res)) {
                            return interaction.editReply(t('music.errors.no_matches'));
                        }

                        const tTrack = res.tracks[0];
                        await RadioSong.create({ url: tTrack.info.uri, title: tTrack.info.title, addedBy: interaction.user.tag });
                        await interaction.editReply(t('music.radio.added_247', { title: tTrack.info.title }));

                        // Refresh UI
                        const state = await PanelState.findOne({ messageId: interaction.message?.id, ownerId });
                        if (state) {
                            const newPayload = await renderMusicPanel(guildId, state, interaction.user.id);
                            if (interaction.message) await interaction.message.edit(newPayload).catch(() => { });
                        }
                    }

                    else if (customId === 'music_modal_radio_remove') {
                        const indexStr = interaction.fields.getTextInputValue('radio_index_input');
                        const index = parseInt(indexStr);
                        if (isNaN(index)) return interaction.editReply(t('music.errors.invalid_index'));

                        const songs = await RadioSong.find();
                        if (index < 1 || index > songs.length) return interaction.editReply(t('music.errors.index_out_of_range', { max: songs.length }));

                        const song = songs[index - 1];
                        await RadioSong.findByIdAndDelete(song._id);
                        await interaction.editReply(t('music.radio.removed', { title: song.title }));

                        // Refresh UI
                        const state = await PanelState.findOne({ messageId: interaction.message?.id, ownerId });
                        if (state) {
                            const newPayload = await renderMusicPanel(guildId, state, interaction.user.id);
                            if (interaction.message) await interaction.message.edit(newPayload).catch(() => { });
                        }
                    }
                    return; // Done Music Modals
                }

                // ================== B. XỬ LÝ BUTTON & MENU ==================
                if (interaction.isButton() || interaction.isStringSelectMenu()) {
                    // 1. Check State xem còn sống không
                    let state = await PanelState.findOne({ messageId: interaction.message.id, ownerId });
                    if (!state && customId !== 'music_nav_close') {
                        return interaction.reply({ content: t('panel.errors.data_error'), ephemeral: true });
                    }

                    // 2. Handle đặc biệt: Đóng Panel
                    if (customId === 'music_nav_close') {
                        await interaction.message.delete().catch(() => { });
                        await PanelState.deleteOne({ messageId: interaction.message.id });
                        return;
                    }

                    // 3. Handle đặc biệt: Mở Modal (KHÔNG ĐƯỢC DEFER UPDATE)
                    if (customId === 'music_pl_create') {
                        const modal = new ModalBuilder().setCustomId(`music_modal_pl_create:${ownerId}`).setTitle(t('panel.modals.title_pl_create'));
                        const nameInput = new TextInputBuilder().setCustomId('pl_name_input').setLabel(t('panel.modals.label_pl_name')).setStyle(TextInputStyle.Short);
                        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                        return interaction.showModal(modal);
                    }
                    if (customId === 'music_queue_add_priority') {
                        const modal = new ModalBuilder().setCustomId(`music_modal_queue_add_priority:${ownerId}`).setTitle(t('panel.modals.title_queue_priority'));
                        const urlInput = new TextInputBuilder().setCustomId('q_url_input').setLabel(t('panel.modals.label_query')).setStyle(TextInputStyle.Short);
                        modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
                        return interaction.showModal(modal);
                    }
                    if (customId === 'music_pl_add_query') {
                        const modal = new ModalBuilder().setCustomId(`music_modal_pl_add_query:${ownerId}`).setTitle(t('panel.modals.title_pl_add'));
                        const urlInput = new TextInputBuilder().setCustomId('pl_query_input').setLabel(t('panel.modals.label_query')).setStyle(TextInputStyle.Short);
                        modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
                        return interaction.showModal(modal);
                    }
                    if (customId === 'music_radio_add_query') {
                        const modal = new ModalBuilder().setCustomId(`music_modal_radio_add:${ownerId}`).setTitle(t('panel.modals.title_radio_add'));
                        const urlInput = new TextInputBuilder().setCustomId('radio_query_input').setLabel(t('panel.modals.label_query')).setStyle(TextInputStyle.Short);
                        modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
                        return interaction.showModal(modal);
                    }
                    if (customId === 'music_radio_remove') {
                        const modal = new ModalBuilder().setCustomId(`music_modal_radio_remove:${ownerId}`).setTitle(t('panel.modals.title_radio_remove'));
                        const indexInput = new TextInputBuilder().setCustomId('radio_index_input').setLabel(t('panel.modals.label_radio_index')).setStyle(TextInputStyle.Short);
                        modal.addComponents(new ActionRowBuilder().addComponents(indexInput));
                        return interaction.showModal(modal);
                    }

                    // 4. Các nút còn lại -> Defer Update (Báo discord "Đang xử lý...")
                    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

                    const player = poru.players.get(interaction.guild.id);
                    // --- LOGIC CẬP NHẬT STATE ---

                    // NAV
                    if (customId.startsWith('music_nav_')) state.currentTab = customId.replace('music_nav_', '');

                    // CONTROLS
                    if (player && state.currentTab === 'home') {
                        if (customId === 'music_btn_pause') player.pause(!player.isPaused);
                        if (customId === 'music_btn_skip') player.skip();
                        if (customId === 'music_btn_stop') { player.destroy(); state.currentTab = 'home'; }
                        if (customId === 'music_btn_loop') player.setLoop(player.loop === 'NONE' ? 'TRACK' : (player.loop === 'TRACK' ? 'QUEUE' : 'NONE'));
                        if (customId === 'music_btn_shuffle' && player.queue.length > 0) {
                            for (let k = player.queue.length - 1; k > 0; k--) {
                                const j = Math.floor(Math.random() * (k + 1));
                                [player.queue[k], player.queue[j]] = [player.queue[j], player.queue[k]];
                            }
                        }
                    }

                    // SETTINGS
                    if (state.currentTab === 'settings') {
                        let setting = await MusicSetting.findOne({ guildId: interaction.guild.id }) || await MusicSetting.create({ guildId: interaction.guild.id });
                        let changed = false;
                        if (customId === 'music_set_vol_up') { setting.volume = Math.min(setting.volume + 10, 150); changed = true; }
                        if (customId === 'music_set_vol_down') { setting.volume = Math.max(setting.volume - 10, 0); changed = true; }
                        if (customId === 'music_set_speed_up') { setting.speed = parseFloat((setting.speed + 0.1).toFixed(1)); changed = true; }
                        if (customId === 'music_set_speed_down') { setting.speed = Math.max(parseFloat((setting.speed - 0.1).toFixed(1)), 0.5); changed = true; }
                        if (customId === 'music_set_speed_reset') { setting.speed = 1.0; changed = true; }
                        if (customId === 'music_set_nightcore') {
                            setting.nightcore = !setting.nightcore;
                            setting.speed = setting.nightcore ? 1.2 : 1.0;
                            setting.pitch = setting.nightcore ? 1.2 : 1.0;
                            changed = true;
                        }
                        if (customId === 'music_set_bass') { setting.bassboost = !setting.bassboost; changed = true; }
                        if (customId === 'music_set_reset') { setting.volume = 100; setting.speed = 1.0; setting.pitch = 1.0; setting.nightcore = false; setting.bassboost = false; changed = true; }

                        if (changed) {
                            await setting.save();
                            if (player) await applyAudioSettings(player);
                        }
                    }

                    // RADIO
                    if (state.currentTab === 'radio') {
                        if (customId === 'music_radio_next') state.radioPage++;
                        if (customId === 'music_radio_prev') state.radioPage = Math.max(1, state.radioPage - 1);
                        if (customId === 'music_radio_toggle' && player) {
                            player.isAutoplay = !player.isAutoplay;
                            // Trigger autoplay nếu rảnh
                            if (player.isAutoplay && !player.currentTrack && player.queue.length === 0) poru.emit('queueEnd', player);
                        }
                        if (customId === 'music_radio_add_current' && player?.currentTrack) {
                            await RadioSong.create({ url: player.currentTrack.info.uri, title: player.currentTrack.info.title, addedBy: interaction.user.tag });
                            await interaction.followUp({ content: t('music.radio.added_short'), ephemeral: true });
                        }
                    }

                    // QUEUE
                    if (state.currentTab === 'queue') {
                        if (customId === 'music_queue_next') state.queuePage++;
                        if (customId === 'music_queue_prev') state.queuePage = Math.max(1, state.queuePage - 1);
                        if (customId === 'music_queue_clear' && player) player.queue.clear();
                        if (customId === 'music_queue_shuffle' && player && player.queue.length > 0) {
                            for (let k = player.queue.length - 1; k > 0; k--) {
                                const j = Math.floor(Math.random() * (k + 1));
                                [player.queue[k], player.queue[j]] = [player.queue[j], player.queue[k]];
                            }
                        }
                    }

                    // PLAYLIST
                    if (state.currentTab === 'playlist') {
                        if (customId === 'music_pl_select') state.selectedPlaylistId = interaction.values[0];
                        if (customId === 'music_pl_delete' && state.selectedPlaylistId) {
                            await UserPlaylist.findOneAndDelete({ _id: state.selectedPlaylistId, userId: ownerId });
                            state.selectedPlaylistId = null;
                        }
                        if (customId === 'music_pl_add_current' && state.selectedPlaylistId && player?.currentTrack) {
                            const pl = await UserPlaylist.findOne({ _id: state.selectedPlaylistId, userId: ownerId });
                            if (pl) {
                                pl.tracks.push({ title: player.currentTrack.info.title, url: player.currentTrack.info.uri, author: player.currentTrack.info.author, duration: player.currentTrack.info.length });
                                await pl.save();
                                await interaction.followUp({ content: t('music.playlist.added_to_selected', { name: pl.name }), ephemeral: true });
                            }
                        }
                        if (customId === 'music_pl_play' && state.selectedPlaylistId) {
                            const pl = await UserPlaylist.findOne({ _id: state.selectedPlaylistId, userId: ownerId });
                            if (pl && pl.tracks.length > 0) {
                                let targetPlayer = player;

                                // Logic tạo Player thông minh (Remote Control)
                                if (!targetPlayer) {
                                    let voice = interaction.member.voice.channel;
                                    // Remote control: Nếu user ko trong voice, tìm voice đầu tiên
                                    if (!voice) {
                                        // Nếu có player cũ (đang dis) thì dùng lại, ko thì tìm kênh mới
                                        if (poru.players.get(interaction.guild.id)) {
                                            voice = interaction.guild.channels.cache.get(poru.players.get(interaction.guild.id).voiceChannel);
                                        }
                                        if (!voice) {
                                            voice = interaction.guild.channels.cache.filter(c => c.type === 2 && c.joinable && !c.full).first(); // 2 = GuildVoice
                                        }
                                    }

                                    if (voice) {
                                        targetPlayer = poru.createConnection({ guildId: interaction.guild.id, voiceChannel: voice.id, textChannel: interaction.channel.id, deaf: false });
                                        await applyAudioSettings(targetPlayer);
                                    } else {
                                        return interaction.followUp({ content: t('music.errors.no_voice_play'), ephemeral: true });
                                    }
                                }

                                if (targetPlayer) {
                                    targetPlayer.queue.clear();
                                    // targetPlayer.stop(); // FIX: Removed to prevent crashes

                                    const tracksToAdd = [];

                                    for (const tTrack of pl.tracks) {
                                        try {
                                            const res = await poru.resolve({ query: tTrack.url, source: 'ytsearch', requester: interaction.user });
                                            if (res.tracks.length > 0) {
                                                const track = res.tracks[0];
                                                track.info.requester = interaction.user;
                                                targetPlayer.queue.add(track);
                                                tracksToAdd.push({ title: tTrack.title, url: tTrack.url, author: tTrack.author, duration: tTrack.duration, requester: interaction.user.tag, addedAt: new Date() });
                                            }
                                        } catch (e) { console.error(tr('logs.interactioncreate.error_error_resolving_playlist_track'), e); }
                                    }

                                    if (targetPlayer.queue.length > 0) {
                                        if (targetPlayer.isPlaying || targetPlayer.isPaused) targetPlayer.skip();
                                        else targetPlayer.play();

                                        await GuildMusicQueue.updateOne({ guildId: interaction.guild.id }, { $set: { tracks: tracksToAdd, updatedAt: new Date() } }, { upsert: true });
                                        await interaction.followUp({ content: t('music.playlist.playing', { name: pl.name }), ephemeral: true });
                                    } else {
                                        await interaction.followUp({ content: t('music.playlist.load_failed'), ephemeral: true });
                                    }
                                }
                            } else {
                                await interaction.followUp({ content: t('music.playlist.empty'), ephemeral: true });
                            }
                        }
                    }

                    // 5. UPDATE UI
                    await state.save();
                    const newPayload = await renderMusicPanel(interaction.guild.id, state, interaction.user.id);
                    await interaction.editReply(newPayload).catch(() => { });
                }

            } catch (err) {
                console.error(tr('logs.interactioncreate.error_music_panel_error'), err);
                // Cố gắng reply nếu chưa reply
                if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: t('panel.errors.process_error'), ephemeral: true }).catch(() => { });
                else if (interaction.deferred) await interaction.followUp({ content: t('panel.errors.process_error'), ephemeral: true }).catch(() => { });
            }
            return; // STOP
        }

        // --- 0.2 XỬ LÝ MODAL CHUNG (Lyrics...) ---
        if (interaction.isModalSubmit() && !interaction.customId?.startsWith('music_')) {
            const customId = interaction.customId;
            if (customId === 'lyrics_modal') {
                if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
                const query = interaction.fields.getTextInputValue('lyrics_query_input');
                try {
                    const data = await GeminiLyrics.findLyrics(query);
                    if (!data.is_found) {
                        return interaction.editReply(t('general.lyrics.not_found', { query }));
                    }
                    const embed = new EmbedBuilder()
                        .setTitle(tr('messages.interactioncreate.settitle_settitle', { song_title: data.song_title }))
                        .setAuthor({ name: data.artist })
                        .setColor(0x1DB954)
                        .setThumbnail(data.thumbnail_url || 'https://cdn-icons-png.flaticon.com/512/3844/3844724.png')
                        .setFooter({ text: t('general.lyrics.footer') })
                        .setTimestamp();
                    if (data.release_year) {
                        embed.addFields({ name: t('general.lyrics.year_field'), value: String(data.release_year), inline: true });
                    }
                    if (data.song_link) {
                        embed.addFields({ name: t('general.lyrics.link_field'), value: `[${t('general.lyrics.link_text')}](${data.song_link})`, inline: true });
                    }
                    if (data.lyrics.length <= 2000) {
                        embed.setDescription(data.lyrics);
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        embed.setDescription(tr('messages.interactioncreate.setdescription_setdescription', { value: data.lyrics.substring(0, 1900), value2: t('general.lyrics.full_lyrics_hint') }));
                        await interaction.editReply({ embeds: [embed] });
                        await sendSafeMessage(interaction, data.lyrics, {
                            forceFile: true,
                            fileName: `${data.song_title}_lyrics.md`.replace(/\s+/g, '_'),
                            fileContent: t('general.lyrics.full_lyrics_header', { title: data.song_title })
                        });
                    }
                } catch (error) {
                    console.error(tr('logs.interactioncreate.error_lyrics_modal_error'), error);
                    await interaction.editReply(t('general.lyrics.error'));
                }
            }
            return;
        }

        // --- 1.4 XỬ LÝ BLOCK-AGENT MENU (MULTI-SELECT) ---
        if (interaction.isStringSelectMenu() && interaction.customId?.startsWith('blockagent_')) {
            try {
                await handleBlockAgentMenu(interaction);
            } catch (err) {
                console.error(tr('logs.interactioncreate.error_block_agent_menu_error'), err);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: tr('messages.interactioncreate.content_loi_khi_xu_ly_block_unblock_model'), flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            }
            return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId?.startsWith('blockchat_')) {
            try {
                await handleBlockModelMenu(interaction);
            } catch (err) {
                console.error(tr('logs.interactioncreate.error_block_model_menu'), err);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: tr('commands.block_model.process_error'), flags: MessageFlags.Ephemeral }).catch(() => {});
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: tr('commands.block_model.process_error'), embeds: [], components: [] }).catch(() => {});
                }
            }
            return;
        }

        // --- 1.5 XỬ LÝ NÚT BẤM SELF-DEV (DEFENSIVE FALLBACK TRÁNH TIMEOUT) ---
        if (interaction.isButton() && interaction.customId?.startsWith('selfdev_')) {
            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.reply({
                        content: tr('messages.interactioncreate.content_lenh_da_duoc_tu_dong_ap_dung'),
                        flags: MessageFlags.Ephemeral
                    });
                }
            } catch (_) { }
            return;
        }

        // --- 1.6 XỬ LÝ DỰ PHÒNG NÚT BẤM SANDBOX / MINIGAME HẾT HẠN HOẶC MẤT KẾT NỐI ---
        if (interaction.isButton() || interaction.isAnySelectMenu()) {
            // Cho phép collector cục bộ của trò chơi xử lý trước trong 1.5 giây
            setTimeout(async () => {
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: tr('messages.interactioncreate.content_van_choi_nay_co_ve_da_het'),
                            flags: MessageFlags.Ephemeral
                        }).catch(() => { });
                    }
                } catch (_) { }
            }, 1500);
        }

        // --- 2. XỬ LÝ LỆNH SLASH ---
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                try {
                    await interaction.reply({ content: t('common.command_not_found'), flags: MessageFlags.Ephemeral });
                } catch (_) { }
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(tr('logs.interactioncreate.error_command_execution_error'), error);
                try {
                    if (interaction.deferred) {
                        await interaction.editReply({ content: t('common.command_error') }).catch(() => { });
                    } else if (!interaction.replied) {
                        await interaction.reply({ content: t('common.command_error'), flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                } catch (_) { }
            }
        }
    });
}
