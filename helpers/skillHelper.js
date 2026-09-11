import fs from 'fs';
import path from 'path';
import Logger from '../class/Logger.js';

/**
 * Quản lý và nhúng Custom Agent Skills theo đặc tả chính thức của Google AI Studio & Antigravity
 * Tham khảo: https://aistudio.google.com/docs/custom-agents
 */
export class SkillHelper {
    static skillRoots = [
        path.join(process.cwd(), '.agents', 'skills'),
        path.join(process.cwd(), 'config', 'prompt', 'skill')
    ];

    /**
     * Quét và nạp tất cả kỹ năng có sẵn từ các thư mục kỹ năng
     * @returns {Array<{ name: string, description: string, content: string, fullContent: string, targetPath: string }>}
     */
    static loadAllSkills() {
        const skillsMap = new Map();

        for (const rootDir of this.skillRoots) {
            if (!fs.existsSync(rootDir)) continue;

            try {
                const subDirs = fs.readdirSync(rootDir, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name);

                for (const dirName of subDirs) {
                    const skillDir = path.join(rootDir, dirName);
                    // Tìm SKILL.md hoặc skills.md
                    const candidates = ['SKILL.md', 'skills.md', `${dirName}.md`];
                    let matchedFile = null;

                    for (const candidate of candidates) {
                        const candidatePath = path.join(skillDir, candidate);
                        if (fs.existsSync(candidatePath)) {
                            matchedFile = candidatePath;
                            break;
                        }
                    }

                    if (!matchedFile) continue;

                    try {
                        const rawContent = fs.readFileSync(matchedFile, 'utf8');
                        const parsed = this.parseSkillContent(rawContent, dirName);
                        if (parsed && !skillsMap.has(parsed.name)) {
                            skillsMap.set(parsed.name, {
                                ...parsed,
                                targetPath: `.agents/skills/${parsed.name}/SKILL.md`,
                                sourceFile: matchedFile
                            });
                        }
                    } catch (readErr) {
                        Logger.warn(`[SkillHelper] ⚠️ Lỗi đọc file skill (${matchedFile}): ${readErr.message}`);
                    }
                }
            } catch (scanErr) {
                Logger.warn(`[SkillHelper] ⚠️ Lỗi quét thư mục skill (${rootDir}): ${scanErr.message}`);
            }
        }

        return Array.from(skillsMap.values());
    }

    /**
     * Tách YAML frontmatter và phần markdown của file SKILL.md
     */
    static parseSkillContent(rawContent, fallbackName) {
        let name = fallbackName;
        let description = '';
        let body = rawContent;

        const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
        if (frontmatterMatch) {
            const yamlStr = frontmatterMatch[1];
            body = frontmatterMatch[2].trim();

            const nameMatch = yamlStr.match(/^name:\s*(.+)$/m);
            if (nameMatch) name = nameMatch[1].trim();

            const descMatch = yamlStr.match(/^description:\s*(.+)$/m);
            if (descMatch) description = descMatch[1].trim();
        }

        return {
            name,
            description,
            body,
            fullContent: rawContent
        };
    }

    /**
     * Chuẩn bị mảng environment.sources để gửi kèm request Antigravity Cloud Interaction API
     * Theo chuẩn: { type: "inline", target: ".agents/skills/<name>/SKILL.md", content: "..." }
     */
    static getEnvironmentSources() {
        const skills = this.loadAllSkills();
        return skills.map(s => ({
            type: "inline",
            target: s.targetPath,
            content: s.fullContent
        }));
    }

    /**
     * Nhúng nội dung kỹ năng vào systemInstruction cho model (hỗ trợ cả Antigravity lẫn Gemini fallback)
     * @param {string} baseInstruction - System instruction gốc
     * @param {string} [userPrompt] - Yêu cầu của người dùng để xác định ngữ cảnh kích hoạt
     */
    static enhanceInstructionWithSkills(baseInstruction, userPrompt = '') {
        const skills = this.loadAllSkills();
        if (skills.length === 0) return baseInstruction;

        let promptLower = (userPrompt || '').toLowerCase();
        let skillsBlock = '\n\n---\n\n## 🛠️ GOOGLE CUSTOM AGENT SKILLS\n';
        skillsBlock += 'Dưới đây là các tài liệu kỹ năng chuyên sâu được nạp sẵn cho Agent. Hãy tuân thủ nghiêm ngặt các nguyên tắc trong kỹ năng liên quan khi thiết kế và lập trình:\n\n';

        for (const skill of skills) {
            // Xác định xem skill có cần thiết cho prompt không
            // Nếu prompt rỗng, hoặc từ khóa skill xuất hiện trong prompt, hoặc số lượng skill ít (<= 3), ta nhúng chi tiết
            const isRelevant = !promptLower ||
                promptLower.includes(skill.name) ||
                (skill.name === 'canvas' && /(vẽ|ảnh|họa|tranh|canvas|card|rank|banner|poster|avatar|photo|image|art)/i.test(promptLower));

            if (isRelevant) {
                skillsBlock += `### 📌 Skill: ${skill.name} (${skill.description || 'Không có mô tả'})\n`;
                skillsBlock += `${skill.body}\n\n`;
            } else {
                skillsBlock += `- **${skill.name}**: ${skill.description} (Khai báo sẵn trong .agents/skills/${skill.name}/SKILL.md)\n`;
            }
        }

        return baseInstruction + skillsBlock;
    }
}

export default SkillHelper;
