import assert from 'assert';
import path from 'path';
import fs from 'fs';
import {
    sandboxManager,
    mappingRegistry,
    manifestManager,
    applyEngine,
    transactionManager
} from '../core/sandbox/index.js';

console.log('--- BẮT ĐẦU KIỂM THỬ AN TOÀN BẢO MẬT SANDBOX CORE ---');

async function runSecurityTests() {
    // 1. Kiểm tra chặn Path Traversal trong SandboxManager
    console.log('\n✅ Test 1: Chặn Path Traversal (../, absolute path)');
    let didBlock1 = false;
    try {
        sandboxManager.resolveSafePath('../../hack.js');
    } catch (e) {
        didBlock1 = true;
        assert.ok(e.message.includes('PATH_OUTSIDE_SANDBOX'));
    }
    assert.ok(didBlock1, 'Phải chặn ../');

    let didBlock2 = false;
    try {
        sandboxManager.resolveSafePath('C:\\Windows\\System32\\cmd.exe');
    } catch (e) {
        didBlock2 = true;
        assert.ok(e.message.includes('PATH_OUTSIDE_SANDBOX'));
    }
    assert.ok(didBlock2, 'Phải chặn đường dẫn tuyệt đối ra ngoài');
    console.log('  -> Chặn Path Traversal hoàn hảo 100%!');

    // 2. Kiểm tra Mapping Registry & Blacklist
    console.log('\n✅ Test 2: Kiểm tra Mapping Registry & Chặn Blacklist Targets');
    const targetSlash = mappingRegistry.resolveTarget('slash/ping.js');
    assert.strictEqual(targetSlash, 'commands/slash/ping.js');

    const targetI18n = mappingRegistry.resolveTarget('i18n/games.json');
    assert.strictEqual(targetI18n, 'resources/vi/games.json');

    // Thử target unmapped
    let didBlockUnmapped = false;
    try {
        mappingRegistry.resolveTarget('random/secret.js');
    } catch (e) {
        didBlockUnmapped = true;
        assert.ok(e.message.includes('UNMAPPED_SOURCE'));
    }
    assert.ok(didBlockUnmapped, 'Phải chặn source không thuộc mapping');

    // Thử target blacklist
    assert.strictEqual(mappingRegistry.isTargetBlacklisted('.env'), true);
    assert.strictEqual(mappingRegistry.isTargetBlacklisted('index.js'), true);
    assert.strictEqual(mappingRegistry.isTargetBlacklisted('core/sandbox/apply-engine.js'), true);
    console.log('  -> Mapping Registry bảo vệ Blacklist chuẩn xác!');

    // 3. Host Re-validation chặn Manifest giả mạo từ Agent
    console.log('\n✅ Test 3: Host Re-validation coi Manifest là Untrusted Input');
    // Giả lập Agent tạo manifest nguy hiểm cố sửa file .env hoặc ghi file bậy
    const maliciousManifest = {
        summary: 'Agent hack attempt',
        changes: [
            {
                action: 'modify',
                source: 'slash/hack.js',
                target: '.env'
            }
        ]
    };

    const revalResult = await manifestManager.revalidateManifest(maliciousManifest);
    assert.strictEqual(revalResult.valid, false, 'Host Re-validation phải phát hiện vi phạm');
    console.log(`  -> Host đã chặn đứng manifest độc hại: ${revalResult.errors[0]}`);

    // 4. Kiểm tra Approval Gate của ApplyEngine
    console.log('\n✅ Test 4: Approval Gate - Cấm Apply khi chưa có Owner Approve');
    let didBlockApproval = false;
    try {
        await applyEngine.apply({ changes: [] }, { isApproved: false });
    } catch (e) {
        didBlockApproval = true;
        assert.ok(e.message.includes('APPLY_BLOCKED'));
    }
    assert.ok(didBlockApproval, 'Phải chặn Apply nếu isApproved là false');
    console.log('  -> Approval Gate hoạt động chuẩn mực!');

    console.log('\n🎉 TOÀN BỘ CÁC BÀI TEST BẢO MẬT SANDBOX ĐỀU ĐẠT CHUẨN 100%!');
}

runSecurityTests().catch(err => {
    console.error('❌ Kiểm thử bảo mật thất bại:', err);
    process.exit(1);
});
