# Chạy Dolia trên Android bằng Termux

Bản này giữ nguyên luồng bot ổn định, nhưng đã bỏ các dependency native không dùng trực tiếp (`canvas`, `sharp`, `gifencoder`) vì chúng dễ lỗi trên Android. Canvas động dùng `@napi-rs/canvas`, package có binary Android arm64.

## 1. Đặt project vào home của Termux

Không chạy lâu dài trực tiếp trong `/storage/emulated/0` vì shared storage có giới hạn symlink/permission với `node_modules`.

```bash
termux-setup-storage
cp -r ~/storage/shared/dolia-stable-termux ~/
cd ~/dolia-stable-termux
```

## 2. Cài môi trường

```bash
bash scripts/termux-setup.sh
```

Script dùng `pkg upgrade` toàn bộ trước khi nâng Node. Termux là rolling release nên partial upgrade có thể làm Node lệch phiên bản `libicu`.

## 3. Tạo `.env`

```bash
cp .env.example .env
nano .env
```

Không gửi `.env` cho người khác.

## 4. Chạy bot

```bash
npm run start:termux
```

Script sẽ giữ wake lock và tự khởi động lại Node nếu tiến trình chết bất thường.

Muốn chạy trong `tmux`:

```bash
tmux new -s dolia
npm run start:termux
```

Detach: `Ctrl+B`, thả ra, rồi bấm `d`.

Quay lại:

```bash
tmux attach -t dolia
```

## 5. HyperOS / MIUI

Trong cài đặt Android:
- Battery saver cho Termux: **No restrictions**
- Bật **Autostart**
- Khóa Termux trong Recent Apps nếu ROM hỗ trợ

`tmux` không cứu được tiến trình nếu Android giết cả ứng dụng Termux.

## 6. Tự chạy sau khi reboot

Cài ứng dụng **Termux:Boot**, mở ứng dụng một lần rồi chạy:

```bash
bash scripts/install-termux-boot.sh
```

Sau lần reboot tiếp theo, script boot sẽ tạo session `tmux` tên `dolia` nếu chưa tồn tại.

## 7. Kiểm tra

```bash
npm run check:termux
npm run check:resources
npm run test:resources
```

`check:termux` kiểm tra Android/Termux, Node, các package chính, `@napi-rs/canvas` và font DejaVu.
