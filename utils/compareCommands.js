import Command from '../models/Command.js';

/**
 * So sánh cấu hình lệnh giữa file mã nguồn và Database.
 * ĐẢM BẢO CHỈ ĐỌC (READ-ONLY) - không được tạo mới hay lưu DB tại đây
 * để tránh việc DB bị ghi nhận là đã deploy khi Discord API chưa kịp nhận lệnh.
 */
export async function commandChanges(cmd) {
    const cmdJSON = cmd.data.toJSON();
    const dbCmd = await Command.findOne({ name: cmd.data.name });

    if (!dbCmd) {
        return true;
    }

    const changed = JSON.stringify(dbCmd.dataJSON) !== JSON.stringify(cmdJSON);
    return changed;
}
