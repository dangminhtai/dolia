import Command from '../models/Command.js';
import { hashCommandData } from '../services/commandDeploymentService.js';

/**
 * So sánh cấu hình lệnh giữa file mã nguồn và Database theo chuẩn SHA-256 (Furina Standard).
 * ĐẢM BẢO CHỈ ĐỌC (READ-ONLY) - không được tạo mới hay lưu DB tại đây
 * để tránh việc DB bị ghi nhận là đã deploy khi Discord API chưa kịp nhận lệnh.
 */
export async function commandChanges(cmd) {
    const cmdJSON = cmd.data.toJSON();
    const currentHash = hashCommandData(cmdJSON);
    const dbCmd = await Command.findOne({ name: cmd.data.name }).lean();

    if (!dbCmd || !dbCmd.dataHash) {
        return true;
    }

    return dbCmd.dataHash !== currentHash;
}
