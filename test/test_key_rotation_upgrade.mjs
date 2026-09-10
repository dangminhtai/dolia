import assert from 'assert';
import apiKeyManager from '../class/apiKeyManager.js';

console.log('--- BẮT ĐẦU KIỂM THỬ HỆ THỐNG XOAY API KEY DOLIA ---');

async function runTests() {
    // 1. Khởi tạo pool giả lập để test độc lập
    apiKeyManager.pool = [
        { key: 'TEST_KEY_AAA', name: 'KEY_1', exhausted: false, lastUsed: 0 },
        { key: 'TEST_KEY_BBB', name: 'KEY_2', exhausted: false, lastUsed: 0 },
        { key: 'TEST_KEY_CCC', name: 'KEY_3', exhausted: false, lastUsed: 0 }
    ];
    apiKeyManager.isInitialized = true;
    apiKeyManager.index = 0;
    apiKeyManager.suspensionCache.clear();

    console.log('✅ Test 1: Kiểm tra Round-Robin tuần tự');
    const k1 = await apiKeyManager._getNextKey('gemini-flash');
    const k2 = await apiKeyManager._getNextKey('gemini-flash');
    const k3 = await apiKeyManager._getNextKey('gemini-flash');
    const k4 = await apiKeyManager._getNextKey('gemini-flash');

    assert.strictEqual(k1, 'TEST_KEY_AAA');
    assert.strictEqual(k2, 'TEST_KEY_BBB');
    assert.strictEqual(k3, 'TEST_KEY_CCC');
    assert.strictEqual(k4, 'TEST_KEY_AAA', 'Round-Robin phải xoay vòng về key đầu tiên');
    console.log('  -> Round-Robin hoạt động hoàn hảo: AAA -> BBB -> CCC -> AAA');

    console.log('\n✅ Test 2: Kiểm tra Fast Failover & Cooldown 60s khi gặp 429');
    apiKeyManager.index = 0; // Đặt lại index để bắt đầu từ key AAA
    // Giả lập key AAA bị 429, key BBB thành công
    const start = Date.now();
    let callCount = 0;

    const result = await apiKeyManager.execute('gemini-flash', async (key) => {
        callCount++;
        if (key === 'TEST_KEY_AAA') {
            const err = new Error('Resource has been exhausted (e.g. check quota)');
            err.status = 429;
            throw err;
        }
        return `SUCCESS_FROM_${key}`;
    }, { maxRetries: 3 });

    const elapsed = Date.now() - start;
    console.log(`  -> Kết quả: ${result}`);
    console.log(`  -> Số lần thử: ${callCount}, Thời gian thực thi: ${elapsed}ms`);
    assert.strictEqual(result, 'SUCCESS_FROM_TEST_KEY_BBB');
    // Thời gian failover chỉ gồm 100ms chờ, phải dưới 500ms
    assert.ok(elapsed < 1000, `Failover phải cực nhanh (< 1000ms), thực tế: ${elapsed}ms`);

    // Kiểm tra thời gian cooldown của key AAA
    const suspendedUntil = apiKeyManager.suspensionCache.get('TEST_KEY_AAA_gemini-flash');
    assert.ok(suspendedUntil > Date.now(), 'Key AAA phải được ghi nhận cooldown');
    const remainingSec = Math.round((suspendedUntil - Date.now()) / 1000);
    console.log(`  -> Cooldown còn lại của TEST_KEY_AAA: ${remainingSec}s (chuẩn 60s, không phải 900s!)`);
    assert.ok(remainingSec >= 55 && remainingSec <= 61, `Cooldown phải khoảng 60s, thực tế: ${remainingSec}s`);

    console.log('\n✅ Test 3: Kiểm tra Timeout Guard (Promise.race)');
    apiKeyManager.index = 1; // Bắt đầu từ BBB để test timeout
    const timeoutStart = Date.now();
    let timeoutCallCount = 0;

    const timeoutResult = await apiKeyManager.execute('gemini-flash', async (key) => {
        timeoutCallCount++;
        if (key === 'TEST_KEY_BBB') {
            // Treo 500ms (trong khi timeout set 150ms)
            await new Promise(r => setTimeout(r, 500));
            return 'NEVER_REACHED';
        }
        return `RECOVERED_BY_${key}`;
    }, { maxRetries: 3, timeoutMs: 150 });

    const timeoutElapsed = Date.now() - timeoutStart;
    console.log(`  -> Kết quả sau timeout: ${timeoutResult}`);
    console.log(`  -> Thời gian xử lý: ${timeoutElapsed}ms, Số lần gọi: ${timeoutCallCount}`);
    assert.strictEqual(timeoutResult, 'RECOVERED_BY_TEST_KEY_CCC');
    assert.ok(timeoutElapsed < 600, `Timeout 150ms + failover 100ms phải dưới 600ms, thực tế: ${timeoutElapsed}ms`);

    console.log('\n✅ Test 4: Kiểm tra All Keys Suspended (Kích hoạt Model Fallback)');
    // Lúc này: AAA đã suspend ở Test 2, BBB đã timeout ở Test 3. Ta suspend nốt CCC:
    apiKeyManager.suspendKey('TEST_KEY_CCC', 'gemini-flash', 60000, 'TEST_SUSPEND');

    let didThrow = false;
    try {
        await apiKeyManager._getNextKey('gemini-flash');
    } catch (e) {
        didThrow = true;
        console.log(`  -> Lỗi ném ra chuẩn: ${e.message}`);
        assert.ok(e.message.includes('ALL_KEYS_SUSPENDED'), 'Phải ném ra ALL_KEYS_SUSPENDED để kích hoạt model fallback');
    }
    assert.ok(didThrow, 'Phải ném lỗi khi tất cả các key đều đang cooldown');

    console.log('\n✅ Test 5: Kiểm tra Lỗi Logic/Syntax nội bộ không bị phạt key hay retry');
    apiKeyManager.suspensionCache.clear();
    apiKeyManager.index = 0;
    let localErrorAttempts = 0;

    let caughtLocalError = null;
    try {
        await apiKeyManager.execute('gemini-flash', async (key) => {
            localErrorAttempts++;
            throw new Error('Lỗi cú pháp JSON từ model AI: Unexpected token');
        }, { maxRetries: 3 });
    } catch (e) {
        caughtLocalError = e;
    }

    assert.ok(caughtLocalError, 'Phải ném lỗi logic ra ngoài ngay lập tức');
    assert.strictEqual(localErrorAttempts, 1, 'Chỉ được gọi đúng 1 lần (KHÔNG ĐƯỢC RETRY làm tốn quota!)');
    assert.strictEqual(apiKeyManager.suspensionCache.size, 0, 'Key hoàn toàn KHÔNG BỊ PHẠT COOLDOWN!');
    console.log('  -> Lỗi logic nội bộ bị chặn chuẩn xác: không phạt key, không retry tốn quota!');

    console.log('\n🎉 TOÀN BỘ CÁC BÀI KIỂM THỬ ĐỀU ĐẠT CHUẨN 100%!');
}

runTests().catch(err => {
    console.error('❌ Kiểm thử thất bại:', err);
    process.exit(1);
});
