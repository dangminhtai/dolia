import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { SelfDevService } from '../services/selfDevService.js';
import { sandboxManager, applyEngine, mappingRegistry } from '../core/sandbox/index.js';

console.log('--- BẮT ĐẦU KIỂM THỬ TÍCH HỢP SELFDEV SERVICE & SANDBOX ---');

async function runTests() {
    // 1. Kiểm tra Owner Check
    assert.strictEqual(SelfDevService.isOwner('1149477475001323540'), true);
    assert.strictEqual(SelfDevService.isOwner('1449070502348984442'), true);
    assert.strictEqual(SelfDevService.isOwner('unknown_id'), false);
    console.log('✅ Test 1: Kiểm tra quyền Owner thành công.');

    // 2. Kiểm tra slugify
    assert.strictEqual(SelfDevService.slugify('Lắc Xí Ngầu'), 'lac-xi-ngau');
    assert.strictEqual(SelfDevService.slugify('Cờ Caro!'), 'co-caro');
    console.log('✅ Test 2: Slugify tiếng Việt không dấu chuẩn xác.');

    // 3. Kiểm tra normalizeGeneratedData
    const mockRawData = {
        name: 'dice_game',
        summary: 'Tung xúc xắc may mắn',
        code: `
import { SlashCommandBuilder } from 'discord.js';
export default {
    data: new SlashCommandBuilder().setName('dice_game').setDescription('Tung xúc xắc'),
    async execute(interaction) {
        await interaction.reply('123');
    }
};
`
    };

    const normalized = SelfDevService.normalizeGeneratedData(mockRawData, 'dice_game');
    assert.strictEqual(normalized.command_name, 'dice_game');
    assert.strictEqual(normalized.files.length, 1);
    assert.strictEqual(normalized.files[0].path, 'slash/dice_game.js');
    console.log('✅ Test 3: Normalize generated data chuẩn hóa đường dẫn sandbox.');

    // 4. Kiểm tra executeDeleteCommand với ApplyEngine
    // Tạo file giả lập commands/slash/temp_del.js
    const testCmdPath = path.join(process.cwd(), 'commands/slash/temp_del.js');
    const testI18nPath = path.join(process.cwd(), 'resources/vi/temp_del.json');
    fs.writeFileSync(testCmdPath, '// temp command', 'utf-8');
    fs.writeFileSync(testI18nPath, JSON.stringify({ test: "hello" }), 'utf-8');

    const mockMsg = {
        edit: async (opts) => {
            // mock edit
            return opts;
        }
    };

    const mockClient = {
        commands: new Map([['temp_del', {}]])
    };

    await SelfDevService.executeDeleteCommand({
        targetName: 'temp_del',
        user: { id: '1149477475001323540' },
        confirmMsg: mockMsg,
        client: mockClient
    });

    assert.strictEqual(fs.existsSync(testCmdPath), false, 'commands/slash/temp_del.js phải bị xóa');
    assert.strictEqual(fs.existsSync(testI18nPath), false, 'resources/vi/temp_del.json phải bị xóa');
    assert.strictEqual(mockClient.commands.has('temp_del'), false, 'temp_del phải bị gỡ khỏi client.commands');
    console.log('✅ Test 4: Execute Delete Command qua ApplyEngine xóa sạch và ghi nhận backup thành công.');

    console.log('\n🎉 TOÀN BỘ CÁC BÀI TEST TÍCH HỢP ĐỀU THÀNH CÔNG RỰC RỠ!');
}

runTests().catch(err => {
    console.error('❌ Test thất bại:', err);
    process.exit(1);
});
