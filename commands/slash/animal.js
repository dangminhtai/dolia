import { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import sharp from 'sharp';

// CẤU HÌNH CÁC "KHO" ẢNH (SUBREDDITS)
// Ông muốn thêm con gì cứ tìm tên subreddit của con đó ném vào mảng
const SUBREDDIT_MAP = {
     'dog': ['dogpictures', 'puppies', 'shiba', 'corgi', 'husky', 'dogs'],
    'cat': ['cats', 'kitten', 'catpictures', 'SupermodelCats', 'catmemes'], 
   'rabbit': ['Rabbits', 'Bunnies', 'rabbitsofreddit'],
    'fox': ['foxes', 'yayfoxxo', 'TrashPandas'], 
    'squirrel': ['squirrels', 'squirrelsEatingPizza'],
    'bird': ['birding', 'wildlifephotography', 'Owls', 'birdpics'],
    'all': ['AnimalsBeingDerps', 'WhatsWrongWithYourDog','horses', 'Equestrian',
        'bears', 'BearGifs','wildlifephotography', 'NatureIsFuckingLit', 'nature', 'ALLTHEANIMALS',
        'aww', 'eyebleach', 'RarePuppers', 'AnimalsBeingDerps'
    ]
};

/**
 * Hàm lấy 1 bài viết ngẫu nhiên từ danh sách Subreddit
 */
async function getRedditPost(topic) {
    // 1. Xác định danh sách subreddit dựa trên từ khóa
    const subList = SUBREDDIT_MAP[topic] || SUBREDDIT_MAP['all'];
    
    // 2. Chọn bừa 1 subreddit trong list (vd: chọn 'shiba' trong list dog)
    const randomSub = subList[Math.floor(Math.random() * subList.length)];
    
    // 3. Gọi Reddit API (Lấy top 50 bài đang HOT để đảm bảo ảnh chất lượng)
    // URL: https://www.reddit.com/r/{tên_sub}/hot.json?limit=50
    const url = `https://www.reddit.com/r/${randomSub}/hot.json?limit=50`;

    try {
        const res = await axios.get(url, {
            headers: { 
                // Reddit chặn User-Agent mặc định của axios, phải giả danh trình duyệt
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
            }
        });

        // 4. Lọc bài viết (Bỏ video, bỏ bài text, bỏ NSFW)
        const posts = res.data.data.children;
        const validPosts = posts.filter(post => {
            const data = post.data;
            return !data.is_video &&                    // Không phải video
                   !data.over_18 &&                     // Không phải 18+
                   data.url &&                          // Có link
                   (data.url.endsWith('.jpg') ||        // Phải là đuôi ảnh
                    data.url.endsWith('.jpeg') || 
                    data.url.endsWith('.png'));
        });

        if (validPosts.length === 0) throw new Error('Không tìm thấy ảnh hợp lệ');

        // 5. Chọn random 1 bài trong các bài hợp lệ
        const randomPost = validPosts[Math.floor(Math.random() * validPosts.length)].data;

        return {
            imageUrl: randomPost.url,
            title: randomPost.title,
            author: randomPost.author,
            subreddit: randomSub,
            upvotes: randomPost.ups,
            permalink: `https://reddit.com${randomPost.permalink}`
        };

    } catch (error) {
        console.error(`Lỗi lấy ảnh từ r/${randomSub}:`, error.message);
        return null;
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('animal')
        .setDescription('Xem ảnh động vật ngẫu nhiên')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addStringOption(option => 
            option.setName('type')
                .setDescription('Chọn loại muốn xem')
                .setRequired(false)
                .addChoices(
                       { name: 'Tất cả', value: 'all' },
                    { name: 'Chó', value: 'dog' },
                    { name: 'Mèo', value: 'cat' },
                    {name: 'Thỏ',value:'rabbit'},
                    { name: 'Cáo', value: 'fox' },
                    { name: 'Chim', value: 'bird' },
                    {name: 'Sóc',value:'squirrel'}
                )
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const type = interaction.options.getString('type') || 'cute';

        // Gọi hàm lấy dữ liệu Reddit
        // Thử tối đa 3 lần nếu mạng lag hoặc xui xẻo bốc trúng sub rỗng
        let redditData = null;
        for (let i = 0; i < 3; i++) {
            redditData = await getRedditPost(type);
            if (redditData) break;
        }

        if (!redditData) {
            return await interaction.editReply('Mạng thằng Admin bị lỗi, vui lòng chờ nó nạp 4G');
        }

        try {
            // --- XỬ LÝ SHARP (Nén ảnh từ Reddit vì ảnh Reddit thường rất nặng) ---
            const imageResponse = await axios.get(redditData.imageUrl, { 
                responseType: 'arraybuffer',
                timeout: 10000
            });

            const imageBuffer = Buffer.from(imageResponse.data);
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();

            // Tỉ lệ mong muốn
            const targetRatio = 1.5;

            // Tính crop
            let cropWidth = metadata.width;
            let cropHeight = Math.floor(cropWidth / targetRatio);

            if (cropHeight > metadata.height) {
            cropHeight = metadata.height;
            cropWidth = Math.floor(cropHeight * targetRatio);
            }

            const left = Math.floor((metadata.width - cropWidth) / 2);
            const top = Math.floor((metadata.height - cropHeight) / 2);

          const processedBuffer = await image
            .extract({ left, top, width: cropWidth, height: cropHeight })
            .resize({ width: 800 })
            .toFormat('jpeg')
            .jpeg({ quality: 85, mozjpeg: true })
            .toBuffer();


            // Tạo file đính kèm
            const fileName = `haruna-animal-${type}-${Date.now()}.jpg`;
            const attachment = new AttachmentBuilder(processedBuffer, { name: fileName });

            // Tạo Embed xịn xò
            const embed = new EmbedBuilder()
                .setColor('#FF4500') // Màu cam đặc trưng của Reddit
                .setTitle(redditData.title.length > 256 ? redditData.title.substring(0, 253) + '...' : redditData.title) // Cắt nếu title quá dài
                .setURL(redditData.permalink) // Bấm vào tiêu đề nhảy ra bài gốc
                .setImage(`attachment://${fileName}`)
                        .setFooter({
            text: `Được yêu cầu bởi ${interaction.user.username}`,
            iconURL: interaction.user.displayAvatarURL({ dynamic: true })
            })
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                files: [attachment]
            });

        } catch (error) {
            console.error("Lỗi xử lý ảnh:", error);
            await interaction.editReply({ content: 'Lỗi 1 chút khi cố gắng lấy ảnh.' }).catch(() => {});
        }
        } catch (e) {
            console.error('[animal]', e);
            try {
                if (interaction.deferred) {
                    await interaction.editReply({ content: 'Có lỗi khi lấy ảnh.' }).catch(() => {});
                } else if (!interaction.replied) {
                    await interaction.reply({ content: 'Có lỗi khi lấy ảnh.', ephemeral: true }).catch(() => {});
                }
            } catch (_) {}
        }
    },
};