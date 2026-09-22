---
name: slash_command
description: Kỹ năng thiết kế slash command Discord tổng quát cho Dolia bằng discord.js v14: command UX, options/subcommands, permissions, response strategy, components, autocomplete, modal, pagination, i18n, error handling, stateful interactions và game khi cần.
---

# Slash Command Skills cho Dolia

## 1) Phạm vi
Skill này áp dụng cho **mọi slash command**, không chỉ game.

Ví dụ:
- thông tin: `/userinfo`, `/serverinfo`, `/avatar`, `/roleinfo`;
- tiện ích: `/help`, `/ping`, `/translate`, `/poll`, `/remind`;
- quản lý: `/clear`, `/timeout`, `/ban`, `/role`, `/channel`;
- cấu hình: `/settings`, `/welcome`, `/automod`, `/music`;
- tìm kiếm/danh sách: `/members`, `/logs`, `/commands`;
- workflow nhiều bước: form/modal, confirm, pagination, wizard;
- game/minigame: chỉ là **một nhóm con** của slash command.

Mục tiêu không phải nhồi thật nhiều Embed/Button. Mục tiêu là tạo lệnh mà người dùng nhìn tên, option và giao diện là hiểu phải làm gì.

---

## 2) Nguyên tắc thiết kế command

Mỗi slash command phải có **một mục đích chính rõ ràng**.

Trước khi tạo lệnh, tự xác định:
1. Người dùng muốn đạt kết quả gì?
2. Dữ liệu nào bắt buộc phải có ngay khi gọi lệnh?
3. Dữ liệu nào nên là option tùy chọn?
4. Có cần subcommand không?
5. Có cần UI tương tác sau khi gọi không?
6. Kết quả nên công khai hay ephemeral?
7. Có action nguy hiểm cần confirm không?
8. Có permission/hierarchy nào phải kiểm tra lại lúc thực thi không?

Không tạo một command kiểu “thùng rác chức năng” chứa quá nhiều hành vi không liên quan.

---

## 3) Tên command, subcommand và option

### Command name
- ngắn, dễ nhớ, đúng ý nghĩa;
- dùng slug ổn định;
- không đổi tên tùy tiện vì tên slash command là một phần UX/API;
- tránh viết tắt khó hiểu nếu tên đầy đủ vẫn ngắn.

Tốt:
```text
/userinfo
/serverinfo
/clear
/settings
/poll
```

Tệ:
```text
/do-stuff
/tool2
/server-management-everything
```

### Khi dùng subcommand
Dùng subcommand khi nhiều thao tác thuộc **cùng một domain**.

Ví dụ:
```text
/role add
/role remove
/role info
```

hoặc:
```text
/settings view
/settings language
/settings notifications
```

Không tách thành subcommand nếu chỉ có một hành động đơn giản.

### Khi dùng subcommand group
Chỉ dùng khi domain thật sự lớn và có cấu trúc tự nhiên.

Ví dụ:
```text
/automod rule create
/automod rule edit
/automod rule delete
/automod status view
```

Đừng dựng cây command ba tầng chỉ để trông “chuyên nghiệp”. Người dùng không đi đào dungeon để tìm một option.

### Option
- chỉ yêu cầu input thật sự cần thiết;
- option bắt buộc phải có tên và description rõ;
- dùng đúng type Discord: user, role, channel, integer, boolean...;
- không bắt người dùng nhập ID nếu Discord có native entity option;
- không bắt nhập text nếu choices/autocomplete/select phù hợp hơn;
- có min/max hợp lý cho integer/number/string khi framework hỗ trợ;
- choice value phải là internal value ổn định, không dùng text dịch làm logic.

Ví dụ tốt:
```text
/clear amount:25 user:@A
```

Tệ:
```text
/clear data:"25|1149477475001323540"
```

---

## 4) Choices và Autocomplete

### Choices
Dùng choices khi:
- tập giá trị nhỏ;
- cố định;
- người dùng nên thấy toàn bộ lựa chọn ngay.

Ví dụ:
```text
language: vi | en | ja
sort: newest | oldest | name
```

### Autocomplete
Dùng autocomplete khi:
- danh sách lớn;
- thay đổi theo runtime;
- cần tìm gần đúng theo text người dùng gõ;
- không phù hợp để hard-code choices.

Autocomplete phải:
- trả kết quả nhanh;
- giới hạn số item;
- không fetch dữ liệu nặng mỗi ký tự nếu có cache;
- validate lại giá trị khi command được execute;
- không coi autocomplete là security boundary.

Nếu option có thể dùng native `User`, `Role`, `Channel`, đừng tự làm autocomplete text thay thế vô ích.

---

## 5) Chọn kiểu phản hồi: public hay ephemeral

### Public phù hợp khi
- kết quả có giá trị cho cả kênh;
- poll, game, bảng trạng thái chung;
- thông báo hành động server cần mọi người thấy;
- nội dung được chủ động yêu cầu đăng công khai.

### Ephemeral phù hợp khi
- settings cá nhân;
- lỗi nhập liệu;
- thiếu quyền;
- confirm riêng;
- thông tin thao tác chỉ người gọi cần;
- menu điều khiển cá nhân;
- phản hồi phụ từ button/select không nên spam kênh.

Không mặc định mọi thứ ephemeral và cũng không mặc định mọi thứ public.
Chọn theo mục đích của lệnh.

---

## 6) Reply, deferReply, editReply, followUp

Interaction phải được acknowledge đúng thời hạn.

### Dùng `reply()` khi
- kết quả có ngay;
- không có tác vụ async đáng kể.

### Dùng `deferReply()` khi
- cần API/network;
- cần xử lý file/ảnh;
- cần query nhiều dữ liệu;
- thời gian xử lý không chắc chắn.

Sau đó dùng:
```js
await interaction.editReply(...)
```

### Dùng `followUp()` khi
- đã có response chính nhưng cần thêm response phụ;
- không dùng để chữa lỗi kiến trúc gửi 5 message liên tiếp không cần thiết.

### Quy tắc
- không `reply()` hai lần cùng interaction;
- không defer rồi quên `editReply()`;
- lỗi sau defer phải sửa/follow-up đúng trạng thái interaction;
- helper phản hồi phải biết interaction đã `replied` hay `deferred`.

---

## 7) Embed: dùng khi nó giúp đọc nhanh

Không bắt buộc slash command nào cũng có Embed.

### Dùng Embed khi
- có nhiều field có cấu trúc;
- hiển thị profile/status/dashboard;
- cần title + description + metadata rõ;
- có pagination hoặc panel tương tác.

### Dùng text thường khi
- kết quả chỉ có 1–3 dòng;
- thông báo thành công đơn giản;
- lỗi ngắn.

Embed nên:
- title ngắn;
- description chứa kết quả chính;
- field chỉ dành cho dữ liệu có cấu trúc;
- tránh field trống hoặc trang trí vô nghĩa;
- không dump JSON/object thô cho người dùng;
- không biến footer thành nơi chứa tiểu thuyết pháp lý.

---

## 8) Chọn đúng Discord Component

### Button
Dùng khi có vài hành động tức thời, rõ ràng.

Ví dụ:
- Xác nhận / Hủy;
- Trang trước / Trang sau;
- Bật / Tắt;
- Làm mới;
- Chỉnh sửa;
- hành động game nhỏ.

### String Select Menu
Dùng khi:
- có nhiều lựa chọn;
- các giá trị cùng loại;
- danh sách vừa phải;
- button sẽ chiếm quá nhiều chỗ.

### User / Role / Channel Select
Dùng khi target là entity Discord tương ứng.
Không tự dựng 20 button tên member/role/channel.

### Modal
Dùng khi cần:
- text dài;
- nhiều field nhập liệu;
- cấu hình chi tiết;
- lý do/moderation note;
- form tạo nội dung.

### Không dùng component khi
- user không cần tương tác thêm;
- button chỉ để trang trí;
- action đã có thể thực hiện ngay từ option slash command.

---

## 9) Quy tắc rải Button tổng quát

Button phải được chia theo **nhóm hành động và mức độ quan trọng**.

### Một hàng nên chứa
- các action cùng loại;
- cùng context;
- cùng cấp độ quyết định.

### Không nên
```text
[ Lưu ] [ Xóa ] [ Trang sau ] [ Mời người ] [ Xem log ]
```

Đây là năm chức năng khác nhau bị nhét chung vì con người phát minh ra ActionRow rồi lập tức muốn lạm dụng nó.

### Nên
```text
Hàng 1: [ Lưu thay đổi ] [ Hủy ]
Hàng 2: [ Xóa cấu hình ]
```

hoặc:
```text
Hàng 1: [ ◀ ] [ 2/8 ] [ ▶ ]
Hàng 2: [ Làm mới ] [ Đóng ]
```

### Style
- `Primary`: hành động chính;
- `Secondary`: điều hướng/trung tính;
- `Success`: xác nhận tích cực rõ ràng;
- `Danger`: xóa/hủy/destructive;
- `Link`: URL thật, không phải action nội bộ.

Không tô màu button cho đẹp. Style phải biểu đạt ý nghĩa.

### Bố cục mobile
- không cố đủ 5 button mỗi row;
- label dài thì giảm số button;
- ưu tiên action chính ở vị trí đầu;
- action destructive nên tách khỏi action thường nếu có thể;
- không để user phải đọc 15 nút mới hiểu panel làm gì.

---

## 10) `custom_id` và định tuyến component

`custom_id` là protocol nội bộ, không phải câu chữ UI.

Quy ước ưu tiên:
```text
<feature>:<session>:<action>[:value]
```

Ví dụ:
```text
settings:a91f:toggle:notifications
help:73ac:page:next
poll:8c21:vote:2
confirm:c15e:delete
```

Quy tắc:
- ngắn;
- ổn định;
- có namespace;
- không dùng label đã dịch làm logic;
- không nhét secret;
- không nhét JSON dài;
- validate lại action/value trước khi dùng.

Nếu UI là stateful, session id giúp interaction cũ không phá phiên mới.

---

## 11) Pagination

Dùng pagination khi output dài hơn mức đọc hợp lý trong một message.

Layout phổ biến:
```text
[ ◀ ] [ 3/12 ] [ ▶ ]
```

Có thể thêm:
```text
[ Đầu ] [ ◀ ] [ 3/12 ] [ ▶ ] [ Cuối ]
```

nhưng chỉ khi thật sự hữu ích.

Quy tắc:
- disable `◀` ở trang đầu;
- disable `▶` ở trang cuối;
- chỉ owner điều khiển nếu panel là cá nhân;
- panel chung thì xác định rõ ai được điều khiển;
- không gửi message mới cho mỗi trang;
- update/edit message hiện tại.

---

## 12) Confirm cho hành động destructive

Các action như:
- xóa dữ liệu;
- reset settings;
- purge lớn;
- delete feature/config;
- thay đổi khó hoàn tác;

nên có confirm nếu mức rủi ro đủ cao.

Layout:
```text
[ Xác nhận ] [ Hủy ]
   Danger      Secondary
```

Phải:
- ghi rõ action sắp xảy ra;
- timeout confirmation;
- sau timeout disable/gỡ button;
- kiểm tra permission/hierarchy **lại khi bấm confirm**;
- không tin rằng user có quyền chỉ vì họ mở được panel 30 giây trước.

Không bắt confirm cho action tầm thường. Confirm mọi thứ cũng khó chịu như cookie banner.

---

## 13) Modal và form nhiều bước

Modal phù hợp cho dữ liệu dạng form.

Nguyên tắc:
- title nói rõ mục tiêu;
- label input cụ thể;
- placeholder chỉ minh họa, không thay label;
- min/max length hợp lý;
- required đúng nhu cầu;
- validate lại server-side;
- lỗi validation phải chỉ ra field nào sai.

Nếu workflow nhiều bước:
```text
Slash command -> panel -> button "Chỉnh sửa" -> modal -> validate -> update panel
```

Đừng ép người dùng nhập mọi thứ ngay trong command options nếu form đó dài và hiếm dùng.

---

## 14) Settings / Dashboard command

Một command cấu hình tốt nên ưu tiên **xem trạng thái hiện tại trước**, sau đó mới cho sửa.

Ví dụ `/settings`:
```text
Embed:
Language: Vietnamese
Notifications: On
Auto reply: Off

Hàng 1: [ Ngôn ngữ ] [ Thông báo ]
Hàng 2: [ Auto reply ] [ Đóng ]
```

Nếu một setting có nhiều giá trị:
- dùng Select Menu.

Nếu setting cần text dài:
- dùng Modal.

Sau mỗi thay đổi:
- lưu dữ liệu;
- render lại trạng thái;
- phản hồi cho user thấy thay đổi đã áp dụng.

---

## 15) Lệnh thông tin / tra cứu

Ví dụ `/userinfo`, `/serverinfo`, `/roleinfo`, `/channelinfo`.

Nguyên tắc:
- dữ liệu quan trọng nhất ở đầu;
- không dump mọi property Discord.js;
- ID chỉ hiển thị nếu hữu ích hoặc user yêu cầu;
- timestamp nên format dễ đọc;
- permission list dài thì tóm tắt hoặc pagination;
- nếu có target option, mặc định hợp lý thường là user/channel hiện tại khi đúng ngữ nghĩa.

Nếu dữ liệu cần fetch runtime:
- fetch thật;
- không đoán;
- xử lý null/missing gracefully.

---

## 16) Lệnh moderation / admin

Lệnh quản trị cần UX rõ và validation chặt hơn lệnh thường.

Phải kiểm tra:
- user invoking có permission phù hợp;
- bot có permission phù hợp;
- role hierarchy;
- target hợp lệ;
- bot không tự tác động sai lên owner/self/protected target theo guard hệ thống;
- input như duration/reason hợp lệ;
- permission được kiểm tra tại thời điểm action.

Kết quả nên nói rõ:
- action nào đã được thực hiện;
- target nào;
- lý do/duration nếu có ý nghĩa.

Không leak stack trace hoặc object API thô.

Hành động destructive/rủi ro cao phải tuân theo guard executor hiện có. Slash command không được tự tạo đường vòng qua guard.

---

## 17) Lệnh tạo nội dung / workflow

Ví dụ:
- `/poll`;
- `/announce`;
- `/embed`;
- `/ticket`;
- `/event`.

Tách dữ liệu thành:
- input bắt buộc ở option;
- input dài/phức tạp ở modal;
- preview/confirm khi action ảnh hưởng công khai đáng kể.

Nếu có preview:
```text
[ Đăng ] [ Chỉnh sửa ] [ Hủy ]
```

`Chỉnh sửa` nên mở Modal hoặc panel phù hợp, không bắt user chạy lại command từ đầu nếu có thể tránh.

---

## 18) Stateful interaction và collector

Không phải command nào cũng cần collector.

Chỉ dùng collector khi message cần sống và nhận nhiều interaction theo thời gian:
- pagination;
- dashboard;
- wizard;
- lobby/game;
- interactive chooser.

Nếu dùng collector, mặc định hệ thống:
```js
{ time: 300000 }
```

### Quy tắc
- ưu tiên một collector chính cho một session/message;
- filter đúng namespace/session;
- validate user/action trong handler;
- timeout thì cleanup component;
- stop collector khi workflow kết thúc;
- không tạo collector lồng nhau sau mỗi click nếu state machine đơn giản làm được.

Sai:
```text
button A -> collector B -> button B -> collector C -> ...
```

Tốt hơn:
```text
1 collector -> parse action -> validate -> mutate state -> render
```

---

## 19) State machine cho workflow nhiều bước

Nếu command có nhiều bước, đừng nhét logic vào callback spaghetti.

State mẫu:
```js
const state = {
  sessionId,
  ownerId: interaction.user.id,
  phase: 'view',
  page: 0,
  data: {},
  ended: false,
};
```

Nên tách:
```text
createState()
validateAction()
applyAction()
renderEmbed()
renderComponents()
finishSession()
```

Áp dụng cho settings wizard, poll builder, interactive help, pagination phức tạp và game.

---

## 20) Disable component theo state

Nếu action chắc chắn không hợp lệ trong state hiện tại, disable nó để UX rõ hơn.

Ví dụ:
- trang đầu -> disable Previous;
- chưa có thay đổi -> disable Save;
- action đang xử lý -> tạm disable nút dễ double-click nếu cần;
- workflow hoàn tất -> disable/remove toàn bộ action;
- option không khả dụng -> disable component tương ứng.

Nhưng vẫn phải validate server-side. UI disabled không phải security boundary.

---

## 21) Chống double-click, race condition và stale interaction

Interaction có thể tới nhanh, trễ hoặc lặp.

Phải:
- validate state trước mutate;
- không áp dụng cùng action hai lần;
- dùng processing lock khi action async quan trọng;
- từ chối interaction của session cũ;
- không revive panel/game đã kết thúc;
- không dựa vào embed text làm source of truth.

Ví dụ:
```js
if (state.ended) return rejectExpired(i);
if (state.processing) return rejectBusy(i);

state.processing = true;
try {
  // validate -> mutate -> persist -> render
} finally {
  state.processing = false;
}
```

---

## 22) Error UX

Chia lỗi thành nhóm:
- input invalid;
- permission denied;
- target invalid;
- resource not found;
- session expired;
- rate limit/busy;
- Discord/API/runtime error.

Phản hồi user:
- ngắn;
- nói vấn đề thực tế;
- nói cách sửa nếu có;
- thường ephemeral nếu lỗi chỉ liên quan người gọi.

Không:
- dump stack trace;
- gửi `[object Object]`;
- bịa nguyên nhân lỗi;
- nói thành công khi API/executor thất bại.

Chi tiết kỹ thuật để log nội bộ.

---

## 23) i18n bắt buộc

Theo schema hệ thống, mọi text cố định người dùng nhìn thấy phải nằm trong `i18n.translations`.

Bao gồm:
- command description;
- option/subcommand description;
- choice name nếu là text hiển thị;
- embed title/description/fields;
- button label;
- select placeholder;
- modal title/label/placeholder;
- success/error/timeout message;
- confirmation text;
- mẫu log nếu hệ thống yêu cầu.

Import:
```js
import { t } from '../../services/i18nService.js';
```

Dùng:
```js
t('settings.buttons.save')
t('clear.success', { amount })
```

Không dùng text đã dịch làm logic.

Sai:
```js
if (button.label === 'Xóa') ...
```

Đúng:
```js
if (action === 'delete') ...
```

Giữ ổn định các placeholder `{{...}}` khi sửa translations.

---

## 24) Permission, security và dữ liệu không tin cậy

Mọi input đều phải coi là untrusted:
- slash option;
- select value;
- modal value;
- custom_id;
- user-provided URL/string;
- data lấy từ session cũ.

Phải:
- validate kiểu/range/length;
- kiểm tra permission/hierarchy;
- không đưa secret/token vào embed/log/custom_id;
- không biến input thành path/module/code execution trực tiếp;
- escape/sanitize khi context yêu cầu;
- không dùng component để bypass deterministic guard của hệ thống.

---

## 25) Logging

Log dành cho debug/audit, không phải nội dung trả cho user.

Log nên có khi cần:
- command/action;
- actor ID;
- target ID;
- guild/channel ID;
- result/error code;
- duration nếu cần performance.

Không log:
- token;
- webhook secret;
- nội dung nhạy cảm không cần thiết;
- toàn bộ object Discord khổng lồ chỉ vì lười chọn field.

---

## 26) Hiệu năng

- dùng cache khi dữ liệu đã đủ và phù hợp;
- fetch khi cần dữ liệu thật/chưa có;
- tránh fetch toàn bộ guild chỉ để lấy một member;
- tránh API call lặp lại trong cùng interaction;
- autocomplete phải nhẹ;
- defer task chậm;
- pagination dữ liệu lớn thay vì nhồi một response;
- dependency ngoài chỉ thêm khi thật sự cần và tương thích `{{host_os}}`.

Không kéo một package 40 MB để format ba con số. Nhân loại đã đi hơi xa rồi.

---

## 27) Accessibility và khả năng đọc

- label button phải hiểu được ngay cả khi emoji không render;
- không chỉ dùng màu để phân biệt ý nghĩa;
- không viết button label quá dài;
- mobile-first khi rải component;
- thông báo lỗi/success không phụ thuộc duy nhất vào emoji;
- thứ tự action phải có logic;
- đừng spam nhiều message nếu một message update được.

---

## 28) Game và minigame

Game sử dụng toàn bộ quy tắc slash command phía trên, cộng thêm state/game rules.

### Cần xác định
- single-player hay multiplayer;
- host/player;
- lobby hay vào game ngay;
- turn/phase;
- win/lose/draw;
- timeout;
- ai được bấm action nào;
- game over cleanup.

### Layout ví dụ
Tic-Tac-Toe:
```text
[ 1 ] [ 2 ] [ 3 ]
[ 4 ] [ 5 ] [ 6 ]
[ 7 ] [ 8 ] [ 9 ]
```

Blackjack:
```text
Hàng 1: [ Hit ] [ Stand ]
Hàng 2: [ Luật chơi ] [ Bỏ cuộc ]
```

Lobby:
```text
Hàng 1: [ Tham gia ] [ Rời phòng ]
Hàng 2: [ Bắt đầu ] [ Luật chơi ]
```

Game không được chiếm tư duy thiết kế của toàn bộ slash command. Nó chỉ là workflow stateful có luật chơi.

---

## 29) Cấu trúc code

- Discord.js v14 + ESM;
- follow loader/module contract đang có của dự án;
- không phát minh kiến trúc export mới nếu không cần;
- import đúng builder thực sự dùng;
- handler không nên vài trăm dòng;
- tách helper khi logic có nhiều trách nhiệm;
- tách render/action/state cho workflow stateful;
- không duplicate component builder ở nhiều nhánh nếu có thể render từ state;
- không hard-code text hiển thị;
- không hard-code OS path;
- dependency phải phù hợp `{{host_os}}`.

---

## 30) Schema output của Dolia

Khi tạo slash command, trả đúng schema hệ thống:

```json
{
  "type": "slash_command",
  "command_name": "safe-slug",
  "summary": "Mô tả ngắn",
  "files": [
    {
      "path": "slash/safe-slug.js",
      "content": "..."
    }
  ],
  "i18n": {
    "key_group": "safe-slug",
    "translations": {
      "title": "...",
      "desc": "..."
    }
  }
}
```

Không thêm Markdown ngoài JSON khi đang ở MODE 2.

---

## 31) Checklist trước khi xuất slash command

### Command design
- tên command rõ nghĩa;
- subcommand chỉ dùng khi hợp lý;
- option dùng đúng Discord type;
- không bắt nhập ID thủ công nếu có entity option;
- choices/autocomplete được chọn đúng trường hợp.

### Response
- interaction luôn được acknowledge;
- task chậm dùng defer;
- public/ephemeral đúng ngữ cảnh;
- không reply hai lần;
- error path vẫn phản hồi đúng trạng thái interaction.

### UI
- không lạm dụng Embed;
- button/select/modal chỉ xuất hiện khi cần;
- button được nhóm theo action;
- destructive action có style/layout rõ;
- pagination disable đúng biên;
- custom_id ổn định và không chứa secret/text dịch.

### State
- collector chỉ dùng khi cần;
- timeout 300000 nếu dùng collector theo quy ước hệ thống;
- timeout/end có cleanup;
- stale interaction không tác động phiên mới;
- chống double-click/race condition nếu workflow có state.

### Security
- validate input;
- permission/hierarchy đúng;
- action nhạy cảm không bypass executor guard;
- không leak secret/internal stack trace.

### i18n
- mọi text cố định user-visible nằm trong translations;
- dùng `t('<command>.<key>', vars)`;
- internal enum/customId/value không phụ thuộc bản dịch.

### Output
- `type` = `slash_command`;
- `command_name` safe slug;
- file dưới `slash/<name>.js`;
- code ESM + discord.js v14;
- JSON cuối hợp lệ.

