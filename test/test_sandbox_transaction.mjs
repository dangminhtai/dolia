import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
    sandboxManager,
    manifestManager,
    applyEngine,
    transactionManager,
    rollbackManager
} from '../core/sandbox/index.js';

console.log('--- BẮT ĐẦU KIỂM THỬ GIAO DỊCH NGUYÊN TỬ VÀ ROLLBACK ---');

async function runTransactionTests() {
    // 1. Chuẩn bị Sandbox
    sandboxManager.cleanSandbox();

    console.log('\n✅ Test 1: Quy trình Apply thành công & Lưu Audit Trail vào .apply/');
    // Viết file lệnh test hợp lệ vào sandbox/slash/sample_ping.js
    const sampleCommandCode = `
import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('sample_ping')
        .setDescription('Test ping command in sandbox'),
    async execute(interaction) {
        await interaction.reply('Pong from Sandbox!');
    }
};
`;
    sandboxManager.writeFile('slash/sample_ping.js', sampleCommandCode);

    // Tạo manifest đề xuất
    const proposed = manifestManager.createProposedManifest('Tạo lệnh sample_ping thử nghiệm', [
        { action: 'create', source: 'slash/sample_ping.js' }
    ]);

    // Apply có phê duyệt của Owner
    const applyResult = await applyEngine.apply(proposed, { isApproved: true, approvedBy: 'TestOwner' });

    assert.strictEqual(applyResult.status, 'APPLIED');
    assert.strictEqual(applyResult.next_action, 'ready_for_reload');
    assert.ok(applyResult.transactionId.startsWith('apply-'));

    // Kiểm tra file production đã được tạo thật
    const prodCmdPath = path.resolve(process.cwd(), 'commands/slash/sample_ping.js');
    assert.ok(fs.existsSync(prodCmdPath), 'File production phải được tạo thành công');

    // Kiểm tra audit storage trong .apply/
    const auditDir = path.resolve(process.cwd(), '.apply', applyResult.transactionId);
    assert.ok(fs.existsSync(auditDir), 'Thư mục transaction phải tồn tại trong .apply/');
    assert.ok(fs.existsSync(path.join(auditDir, 'manifest.json')), 'Phải có manifest.json snapshot');
    assert.ok(fs.existsSync(path.join(auditDir, 'result.json')), 'Phải có result.json audit log');

    const resultLog = JSON.parse(fs.readFileSync(path.join(auditDir, 'result.json'), 'utf-8'));
    assert.strictEqual(resultLog.status, 'COMMITTED');
    console.log(`  -> Giao dịch ${applyResult.transactionId} đã COMMIT và lưu audit trail thành công!`);

    console.log('\n✅ Test 2: Tự động Rollback khi Deep Verification thất bại (Lỗi Unresolved Import)');
    // Viết một file có cú pháp JS đúng nhưng import module không tồn tại
    const badCommandCode = `
import { SlashCommandBuilder } from 'discord.js';
import ghostModule from './non_existent_ghost_module.js';

export default {
    data: new SlashCommandBuilder()
        .setName('bad_command')
        .setDescription('Command with missing import'),
    async execute(interaction) {
        ghostModule.run();
    }
};
`;
    sandboxManager.writeFile('slash/bad_command.js', badCommandCode);
    const badProposed = manifestManager.createProposedManifest('Lệnh lỗi import', [
        { action: 'create', source: 'slash/bad_command.js' }
    ]);

    let didRollback = false;
    try {
        await applyEngine.apply(badProposed, { isApproved: true, approvedBy: 'TestOwner' });
    } catch (err) {
        didRollback = true;
        console.log(`  -> Bắt được lỗi và đã kích hoạt Rollback: ${err.message}`);
        assert.ok(err.message.includes('HOST_REVALIDATION_FAILED') || err.message.includes('ROLLED_BACK'));
    }
    assert.ok(didRollback, 'Phải kích hoạt Rollback khi phát hiện module không tồn tại');

    // Kiểm tra file bad_command.js KHÔNG được phép tồn tại trong production
    const badProdPath = path.resolve(process.cwd(), 'commands/slash/bad_command.js');
    assert.ok(!fs.existsSync(badProdPath), 'File lỗi không được tồn tại trong production');
    console.log('  -> Rollback hoàn hảo: File lỗi đã bị loại bỏ, production sạch 100%!');

    // Dọn dẹp file test sample_ping
    if (fs.existsSync(prodCmdPath)) {
        fs.rmSync(prodCmdPath, { force: true });
    }
    sandboxManager.cleanSandbox();

    console.log('\n🎉 TOÀN BỘ CÁC BÀI TEST GIAO DỊCH & ROLLBACK ĐỀU ĐẠT CHUẨN 100%!');
}

runTransactionTests().catch(err => {
    console.error('❌ Kiểm thử giao dịch thất bại:', err);
    process.exit(1);
});
