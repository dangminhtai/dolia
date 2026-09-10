
import ChildBotConfig from '../models/ChildBotConfig.js';

/**
 * Get configuration value from database
 * @param {string} key - Configuration key
 * @returns {Promise<any>} - The value associated with the key, or null if not found
 */
export async function getConfig(key) {
    try {
        const config = await ChildBotConfig.findOne({ key });
        return config ? config.value : null;
    } catch (error) {
        console.error(`Error getting config for key "${key}":`, error);
        return null; // Fail safe
    }
}

/**
 * Set configuration value in database
 * @param {string} key - Configuration key
 * @param {any} value - Value to set
 * @returns {Promise<void>}
 */
export async function setConfig(key, value) {
    try {
        await ChildBotConfig.findOneAndUpdate(
            { key },
            { value },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error(`Error setting config for key "${key}":`, error);
        throw error;
    }
}
