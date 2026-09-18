import { t as tr } from '../../services/i18nService.js';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { builtinModules } from 'module';
import Logger from '../../class/Logger.js';

const execPromise = promisify(exec);

// Regex kiểm tra tên package npm hợp lệ và an toàn (chống command injection)
const NPM_PACKAGE_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

// Danh sách các package hệ thống bị chặn không cho phép can thiệp
const BLOCKED_PACKAGES = new Set([
    'npm', 'yarn', 'pnpm', 'node', 'core-js', 'process'
]);

const TERMUX_INCOMPATIBLE_PACKAGES = new Set([
    'canvas',
    'sharp',
    'gifencoder',
    'gif-encoder-2'
]);

const isTermuxHost = () => process.platform === 'android'
    || Boolean(process.env.TERMUX_VERSION)
    || String(process.env.PREFIX || '').includes('com.termux');

export class PackageInstaller {
    /**
     * Trích xuất tên package gốc từ chuỗi import (vd: '@napi-rs/canvas' hoặc 'lodash/get' -> 'lodash')
     */
    static getRootPackageName(importPath) {
        if (!importPath || typeof importPath !== 'string') return null;

        const trimmed = importPath.trim();
        // Bỏ qua các file nội bộ tương đối hoặc tuyệt đối
        if (trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
            return null;
        }

        // Bỏ qua built-in prefix của Node.js (vd: 'node:fs', 'node:path')
        if (trimmed.startsWith('node:')) {
            return null;
        }

        const parts = trimmed.split('/');
        if (trimmed.startsWith('@')) {
            if (parts.length >= 2) {
                return `${parts[0]}/${parts[1]}`;
            }
            return trimmed;
        }
        return parts[0];
    }

    /**
     * Kiểm tra xem package đã có sẵn trong node_modules hoặc package.json chưa
     */
    static isPackageInstalled(pkgName) {
        if (!pkgName) return true;
        if (builtinModules.includes(pkgName) || builtinModules.includes(pkgName.replace(/^node:/, ''))) {
            return true;
        }

        try {
            const pkgJsonPath = path.join(process.cwd(), 'package.json');
            if (fs.existsSync(pkgJsonPath)) {
                const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
                const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
                if (deps[pkgName]) return true;
            }

            const modulePath = path.join(process.cwd(), 'node_modules', pkgName);
            return fs.existsSync(modulePath);
        } catch (_) {
            return false;
        }
    }

    /**
     * Tự động cài đặt an toàn một package qua npm vào dự án
     */
    static async installPackage(pkgName) {
        if (!pkgName || typeof pkgName !== 'string') return false;

        const cleanName = pkgName.trim().toLowerCase();

        // 1. Kiểm tra tính hợp lệ của tên package để chống Command Injection
        if (!NPM_PACKAGE_NAME_REGEX.test(cleanName)) {
            Logger.warn(tr('logs.package_installer.warn_packageinstaller_ten_package_khong_hop_le_hoac', { pkgName: pkgName }));
            return false;
        }

        if (BLOCKED_PACKAGES.has(cleanName)) {
            Logger.warn(tr('logs.package_installer.warn_packageinstaller_package_nam_trong_danh_sach_bao', { cleanName: cleanName }));
            return false;
        }

        if (isTermuxHost() && TERMUX_INCOMPATIBLE_PACKAGES.has(cleanName)) {
            Logger.warn(tr('logs.package_installer.warn_packageinstaller_package_khong_tuong_thich_termux', { cleanName }));
            return false;
        }

        if (this.isPackageInstalled(cleanName)) {
            return true; // Đã cài sẵn, bỏ qua
        }

        Logger.info(tr('logs.package_installer.info_packageinstaller_phat_hien_thu_vien_moi_dang', { cleanName: cleanName }));
        try {
            await execPromise(`npm install ${cleanName} --no-audit --prefer-offline`, {
                cwd: process.cwd(),
                timeout: 60000
            });
            Logger.info(tr('logs.package_installer.info_packageinstaller_da_cai_dat_thanh_cong_du', { cleanName: cleanName }));
            return true;
        } catch (err) {
            Logger.error(tr('logs.package_installer.error_packageinstaller_cai_dat_thu_vien_that_bai', { cleanName: cleanName, message: err.message }));
            return false;
        }
    }

    /**
     * Quét mã nguồn JavaScript và tự động cài đặt tất cả các package bị thiếu
     */
    static async ensureDependencies(codeString) {
        if (!codeString || typeof codeString !== 'string') return [];

        const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
        const requiredPackages = new Set();

        let match;
        while ((match = importRegex.exec(codeString)) !== null) {
            const rawTarget = match[1] || match[2];
            const rootPkg = this.getRootPackageName(rawTarget);
            if (rootPkg && !this.isPackageInstalled(rootPkg)) {
                requiredPackages.add(rootPkg);
            }
        }

        const installed = [];
        for (const pkg of requiredPackages) {
            const success = await this.installPackage(pkg);
            if (success) installed.push(pkg);
        }

        return installed;
    }
}

export default PackageInstaller;
