# 对标全片校准笔记

时间：2026-10-15（Asia/Shanghai）  
对标：Tristen O’Brien — Claude Code Just Dropped MODS  
素材：**用户发送的整支视频附件**（非仅 YouTube 拉取摘要）  
路径：`/workspace/aroll-rules/ref-full-2026-10-15/ref.mp4`（≈599.86s，1920×1080，60fps）  
方法：**密帧 75 张（约每 8s）+ 对全部 f_001…f_075 做 Read 视觉目检**；对照 `broll-ref/VISUAL-GRAMMAR.md` 与旧版规则。  
**watchVideo 不可用/失败** → 未做逐帧播放；动效时长与精确切点为静帧 *inferred*。

## 相对上一版（同日早先密帧校准）改了什么

1. **证据源升级**  
   改为用户整片附件目录 `ref-full-2026-10-15/`，并产出完整 `FRAME-CATALOG.md`（75/75 行观察），不再只依赖零散补帧叙述。

2. **反「黑胶囊默认」升格为系统规则**  
   Owner 偏好写入 §1 一句话系统、§3 组件排序、§5 新「主叠加语言」行、§9/§10 自检与返工表。对标实测：黑胶囊常见作 kicker/状态/outro，但英雄语言更多是奶油卡、mac/产品窗、动能字、贴纸、进度 UI。

3. **产品 UI 量化**  
   密帧中纯产品/终端/Dock/Photos/站点约 **~22/75**，与 Split（~20）并列最高频 → 规则中明确「一等公民」与推荐节拍含产品长镜。

4. **Lesson+PiP 再计数**  
   本密帧集明确可见约 **6** 次（f_003, 019–020, 037, 069, 070）；另有 Photos 角 PiP 弧（~6）作混合变体。

5. **同色/同家族连刀**  
   新目录再确认：钴蓝卡 f_006–007、粉叙事 f_043–044、Photos 步骤 f_049–054、翠绿安装 f_067–069、赞助站 f_060–061、游戏 f_062–064。

6. **M/I/E 库扩容（有帧证据）**  
   - M16–M21：扇窗、对角贴纸阶梯、模态盖窗、进度环、删除线盖章、步骤累加点亮  
   - I16–I20：sunburst、彩点队、霓虹品牌标、像素角标、方程砖  
   - E11–E13：outro 多 CTA、$0 倾卡、卡内嵌打字条  

7. **Outro**  
   f_075 确认 Thanks 奶油卡 + Sponsor 近黑卡 + Comment/Like 奶油 pill + 次要 mustard 标签；限定 **outro 一次**。

## 置信度

| 项 | 置信 | 说明 |
|----|------|------|
| 版式家族与叠加语言 | 高 | 75 帧逐张 Read |
| 舞台主色 / 贴纸六色 | 高 | 与 VISUAL-GRAMMAR 一致 |
| 同色/同家族连刀 | 高 | 多段连续密帧 |
| 精确切点秒数 | 中 | ≈8s 粒度 |
| 逐刀 spring 时长（0.3s 等） | 中–低 | 静帧 *inferred* + 旧语法；无 watchVideo |
| VO / 口播对齐 | — | 本校准不锁 VO |

## 产出路径

- 帧目录：`/workspace/aroll-rules/ref-full-2026-10-15/FRAME-CATALOG.md`
- 规则正文：`/workspace/aroll-rules/AROLL-BROLL-MOTION-RULES.md`（权威重写）
- 用户摘要：`/workspace/aroll-rules/ref-full-2026-10-15/USER-SUMMARY-zh.md`
- 本笔记：`/workspace/aroll-rules/CALIBRATION-NOTES.md`
- 密帧：`/workspace/aroll-rules/ref-full-2026-10-15/frames/f_001.jpg` … `f_075.jpg`
