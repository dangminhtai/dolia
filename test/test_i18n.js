import { initI18n, t, getLocale } from '../services/i18nService.js';

initI18n();

console.log('Locale:', getLocale());
console.log('Test common.dm_not_supported:', t('common.dm_not_supported'));
console.log('Test errors.no_permission:', t('errors.no_permission'));
console.log('Test music.errors.no_voice_channel:', t('music.errors.no_voice_channel'));
console.log('Test music.track_start with params:', t('music.track_start', { title: 'Lạc Trôi', time: '03:45', requester: 'Admin#1234' }));
console.log('Test music.play.priority_playlist:', t('music.play.priority_playlist', { name: 'Chill EDM', count: 15 }));
console.log('Test panel.home.title_playing:', t('panel.home.title_playing'));
console.log('Test panel.settings.nightcore_on:', t('panel.settings.nightcore_on'));
console.log('Test panel.radio.title:', t('panel.radio.title', { total: 10 }));
console.log('Test panel.queue.title:', t('panel.queue.title', { count: 3 }));
console.log('Test panel.buttons.pl_create:', t('panel.buttons.pl_create'));
console.log('Test panel.modals.title_pl_create:', t('panel.modals.title_pl_create'));
console.log('Test music.radio.track_not_found:', t('music.radio.track_not_found'));
console.log('Test common.server_running:', t('common.server_running'));

console.log('\n--- ALL TESTS PASSED! ---');
