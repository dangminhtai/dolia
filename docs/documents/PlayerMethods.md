# Poru Player Documentation

## 🔹 Available Methods/Properties
This list documents the available methods and properties on the Player object (Poru/Lavalink).

### Properties
- `autoplay`
- `connection`
- `currentTrack`
- `data`
- `filters`
- `guildId`
- `isAutoPlay`
- `isConnectToVoiceReceiver`
- `isConnected`
- `isPaused`
- `isPlaying`
- `isQuietMode`
- `loop`
- `node`
- `options`
- `ping`
- `poru`
- `position`
- `previousTrack`
- `queue`
- `textChannel`
- `timestamp`
- `voiceChannel`
- `volume`
- `voiceReceiverAttempt`
- `voiceReceiverClose`
- `voiceReceiverDisconnect`
- `voiceReceiverError`
- `voiceReceiverMessage`
- `voiceReceiverOpen`
- `voiceReceiverReconnect`
- `voiceReceiverReconnectTimeout`
- `voiceReceiverReconnectTries`
- `voiceReceiverWsClient`

### Methods
- `addListener(event, listener)`
- `autoMoveNode()`
- `connect(options)`
- `destroy()`
- `disconnect()`
- `emit(event, ...args)`
- `eventHandler(data)`
- `eventNames()`
- `get(key)`
- `getLyrics(track)`
- `getMaxListeners()`
- `listenerCount(eventName)`
- `listeners(eventName)`
- `moveNode(name)`
- `mute(boolean)`
- `off(eventName, listener)`
- `on(eventName, listener)`
- `once(eventName, listener)`
- `pause(boolean)`
- `play()`
- `prependListener(eventName, listener)`
- `prependOnceListener(eventName, listener)`
- `rawListeners(eventName)`
- `removeAllListeners(eventName)`
- `removeListener(eventName, listener)`
- `removeVoiceReceiverConnection()`
- `resolve(options)`
- `resolveTrack(track)`
- `restart()`
- `seekTo(position)`
- `send(data)`
- `set(key, value)`
- `setLoop(mode)`: 'NONE' | 'TRACK' | 'QUEUE'
- `setMaxListeners(n)`
- `setTextChannel(channelId)`
- `setVoiceChannel(channelId)`
- `setVolume(volume)`
- `setupVoiceReceiverConnection()`
- `skip()`
- `startsWithMultiple(prefix)`

### Internal/Private
- `_events`
- `_eventsCount`
- `_maxListeners`
- `constructor`
