import chalk from 'chalk';
import { inspect } from 'node:util';
import { t } from '../services/i18nService.js';

const styles = {
    info: [chalk.bgBlue.bold, chalk.blue],
    warn: [chalk.bgYellow.black.bold, chalk.yellow],
    error: [chalk.bgRed.white.bold, chalk.red],
    success: [chalk.bgGreen.black.bold, chalk.green],
    debug: [chalk.bgMagenta.white.bold, chalk.magenta],
    client: [chalk.bgCyan.black.bold, chalk.cyan],
    system: [chalk.bgWhite.black.bold, chalk.white]
};

export default class Logger {
    static getTimestamp() {
        return chalk.gray(t('logs.logger.timestamp', {
            time: new Date().toLocaleTimeString('vi-VN', { hour12: false })
        }));
    }

    static write(level, ...args) {
        const [badge, color] = styles[level];
        const text = args.map(value => {
            if (value instanceof Error) return level === 'info' ? value.message : value.stack || value.message;
            if (value && typeof value === 'object') return inspect(value, { depth: 4, colors: false });
            return String(value ?? '');
        }).join(' ');
        console.log(t('logs.logger.line', {
            timestamp: this.getTimestamp(),
            level: badge(t(`logs.logger.${level}`)),
            message: color(text)
        }));
    }

    static info(...args) { this.write('info', ...args); }
    static warn(...args) { this.write('warn', ...args); }
    static error(...args) { this.write('error', ...args); }
    static success(...args) { this.write('success', ...args); }
    static debug(...args) { this.write('debug', ...args); }
    static client(...args) { this.write('client', ...args); }
    static system(...args) { this.write('system', ...args); }
}
