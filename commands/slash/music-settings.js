import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import MusicSetting from '../../models/MusicSetting.js';
import { applyAudioSettings } from '../../utils/AudioController.js';

export default {
    data: new SlashCommandBuilder()
        .setName('music-settings')
        .setDescription('Cài đặt âm thanh phát trong kênh'),

    async execute(interaction) {
        const player = poru.players.get(interaction.guild.id);

        // Lấy setting từ DB (hoặc tạo mới nếu chưa có)
        let setting = await MusicSetting.findOne({ guildId: interaction.guild.id });
        if (!setting) setting = await MusicSetting.create({ guildId: interaction.guild.id });

        // Hàm vẽ giao diện cập nhật theo data mới nhất
        const renderMenu = (s) => {
            const embed = new EmbedBuilder()
                .setColor('#FF00FF')
                .setTitle('🎛️ STUDIO ÂM THANH')
                .setDescription(`Cài đặt sẽ được **LƯU VĨNH VIỄN** cho server này.`)
                .addFields(
                    { name: '🔊 Volume', value: `${s.volume}%`, inline: true },
                    { name: '⏩ Speed', value: `${s.speed.toFixed(1)}x`, inline: true },
                    { name: '🗣️ Pitch', value: `${s.pitch.toFixed(1)}x`, inline: true },
                    { name: '🐿️ Nightcore', value: s.nightcore ? '✅ Bật' : '❌ Tắt', inline: true },
                    { name: '🥁 Bassboost', value: s.bassboost ? '✅ Bật' : '❌ Tắt', inline: true },
                )
                .setFooter({ text: 'Bấm nút để chỉnh. Bot sẽ tự cập nhật ngay lập tức.' });

            // Hàng 1: Volume
            const rowVol = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('vol_down').setLabel('Vol -10').setStyle(ButtonStyle.Secondary).setEmoji('🔉'),
                new ButtonBuilder().setCustomId('vol_up').setLabel('Vol +10').setStyle(ButtonStyle.Secondary).setEmoji('🔊')
            );

            // Hàng 2: Speed (Tốc độ)
            const rowSpeed = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('speed_down').setLabel('Speed -0.1').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('speed_reset').setLabel('Speed Chuẩn').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('speed_up').setLabel('Speed +0.1').setStyle(ButtonStyle.Primary)
            );

            // Hàng 3: Hiệu ứng đặc biệt
            const rowEffect = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('toggle_nc').setLabel('Nightcore').setStyle(s.nightcore ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🐿️'),
                new ButtonBuilder().setCustomId('toggle_bass').setLabel('Bassboost').setStyle(s.bassboost ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🥁'),
                new ButtonBuilder().setCustomId('reset_all').setLabel('Reset All').setStyle(ButtonStyle.Danger).setEmoji('🧹')
            );

            return { embeds: [embed], components: [rowVol, rowSpeed, rowEffect] };
        };

        const msg = await interaction.reply(renderMenu(setting));

        const collector = msg.createMessageComponentCollector({ time: 120000 }); // 2 phút

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'Không phải việc của ông!', ephemeral: true });

            // Cập nhật DB dựa trên nút bấm
            switch (i.customId) {
                // Volume
                case 'vol_up': setting.volume = Math.min(setting.volume + 10, 150); break;
                case 'vol_down': setting.volume = Math.max(setting.volume - 10, 0); break;

                // Speed
                case 'speed_up': setting.speed = parseFloat((setting.speed + 0.1).toFixed(1)); break;
                case 'speed_down': setting.speed = Math.max(parseFloat((setting.speed - 0.1).toFixed(1)), 0.5); break;
                case 'speed_reset': setting.speed = 1.0; break;

                // Effects
                case 'toggle_nc':
                    setting.nightcore = !setting.nightcore;
                    if (setting.nightcore) { setting.speed = 1.2; setting.pitch = 1.2; } // Auto chỉnh speed/pitch theo chuẩn Nightcore
                    else { setting.speed = 1.0; setting.pitch = 1.0; }
                    break;
                case 'toggle_bass': setting.bassboost = !setting.bassboost; break;

                // Reset
                case 'reset_all':
                    setting.volume = 100;
                    setting.speed = 1.0;
                    setting.pitch = 1.0;
                    setting.nightcore = false;
                    setting.bassboost = false;
                    break;
            }

            // 1. Lưu vào DB
            await setting.save();

            // 2. Áp dụng ngay vào Bot (nếu đang hát)
            if (player) {
                await applyAudioSettings(player);
            }

            // 3. Cập nhật giao diện (Update chứ không gửi mới -> Chống lag)
            await i.update(renderMenu(setting));
        });

        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => { });
        });
    },
};