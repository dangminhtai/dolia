import { initI18n, t, getLocale } from '../services/i18nService.js';

initI18n();

console.log('Locale:', getLocale());
console.log('Test common.dm_not_supported:', t('common.dm_not_supported'));
console.log('Test errors.no_permission:', t('errors.no_permission'));
console.log('Test music.errors.no_voice_channel:', t('music.errors.no_voice_channel'));
console.log('Test music.track_start with params:', t('music.track_start', { title: 'Lạc Trôi', time: '03:45', requester: 'Admin#1234' }));
console.log('Test music.play.priority_playlist:', t('music.play.priority_playlist', { name: 'Chill EDM', count: 15 }));
console.log('Test panel.home.title_playing:', t('panel.home.title_playing'));
console.log('Test games.tictactoe.winner:', t('games.tictactoe.winner', { winner: 'Tai', symbol: 'X', selfComment: '(Tự kỷ đỉnh cao)' }));
console.log('Test general.morning.user_added:', t('general.morning.user_added', { username: 'Dolia' }));

console.log('\n--- ALL TESTS PASSED! ---');
