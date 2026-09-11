import chalk from 'chalk';

export default class Logger {
    static getTimestamp() {
        return chalk.gray(`[${new Date().toLocaleTimeString('vi-VN', { hour12: false })}]`);
    }

    static info(...args) {
        const text = args.map(a => typeof a === 'object' ? (a?.message || JSON.stringify(a)) : a).join(' ');
        console.log(`${this.getTimestamp()} ${chalk.bgBlue.bold(' INFO ')} ${chalk.blue(text)}`);
    }

    static warn(...args) {
        const text = args.map(a => typeof a === 'object' ? (a?.stack || a?.message || JSON.stringify(a)) : a).join(' ');
        console.log(`${this.getTimestamp()} ${chalk.bgYellow.black.bold(' WARN ')} ${chalk.yellow(text)}`);
    }

    static error(...args) {
        const text = args.map(a => typeof a === 'object' ? (a?.stack || a?.message || JSON.stringify(a)) : a).join(' ');
        console.log(`${this.getTimestamp()} ${chalk.bgRed.white.bold(' ERROR ')} ${chalk.red(text)}`);
    }

    static success(text) {
        console.log(`${this.getTimestamp()} ${chalk.bgGreen.black.bold(' SUCCESS ')} ${chalk.green(text)}`);
    }

    static debug(text) {
        console.log(`${this.getTimestamp()} ${chalk.bgMagenta.white.bold(' DEBUG ')} ${chalk.magenta(text)}`);
    }

    static client(text) {
        console.log(`${this.getTimestamp()} ${chalk.bgCyan.black.bold(' CLIENT ')} ${chalk.cyan(text)}`);
    }

    static system(text) {
        console.log(`${this.getTimestamp()} ${chalk.bgWhite.black.bold(' SYSTEM ')} ${chalk.white(text)}`);
    }
}
