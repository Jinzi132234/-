# Translate Workbench · Windows

## 安裝

1. 安裝 **Node.js 20+**：https://nodejs.org/
2. 安裝 **Python 3.10+**：https://www.python.org/downloads/
   - 安裝時勾選 **Add Python to PATH**
3. 解壓這個資料夾。
4. 雙擊 **install-windows.bat**。
5. 雙擊 **start-windows.bat**。
6. 瀏覽器打開：http://127.0.0.1:4321

## 第一次轉寫

Whisper 會自動下載模型。需要網路與幾 GB 空間。

## 模型 API

打開工作台右上角 **設定 → 模型接入**：

- **DeepSeek**：翻譯／文案／英文分鏡／AROLL／BROLL XML
- **Base 人物視頻**：APIMODELS 或 Google Omni
- **Opus 5.5**：4router 或 OpenAI 兼容接口

API Key 只保存在本機 `data/settings.json`，不會上傳 GitHub。

## 注意

- 人物 Base 用 APIMODELS 時，場景圖／三視圖必須是公開 URL。
- Windows TTS 使用系統內建 SAPI（英文語音）。
- 如果 HTML renderer 找不到 Chromium，安裝 Google Chrome 即可。
- 防火牆若詢問，允許 Node.js 存取本機連接埠 4321。
