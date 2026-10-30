# Story ending downloads and restart controls

## Summary

故事结束页将 PDF、PNG、ZIP 收成一组下载按钮；「从头再看」成为主操作，「开启下一篇」移到下方，移除「有点余味 / 再想想」及相关前端状态和样式。阅读页在上一幅按钮左侧新增带描边和背景的「从头看」按钮，复用现有重读逻辑返回第一幅。

ZIP 在浏览器本地生成，包含 `分镜.md` 和按阅读顺序编号的原图。分镜保留旁白、画面提示词、余味、出处及已保存的制作要求。缺图、跨域地址、读取失败、空图片或错误内容类型会中止打包；界面提供进度、失败提示和重复下载入口。阅读偏好中也可下载 ZIP。

## Verification

- Node 24.22.1 / pnpm 11.25.0；`pnpm typecheck`、`pnpm lint` 通过。后续 Reader 修改的类型检查和定向 ESLint 通过；最后一次修改仅涉及按钮 CSS。
- `pnpm exec node --experimental-strip-types --test tests/reader-zip.test.mjs tests/reader-png.test.mjs tests/reader-interaction.test.mjs`：17/17 通过，覆盖 ZIP 完整性、编号、原图字节、分镜内容和失败拒绝，以及现有 PNG 和阅读交互逻辑。
- 内置浏览器验证《大葫芦，往哪里用》结束页及阅读偏好入口，完成实际 ZIP 下载和重复下载。Python `zipfile` 独立核验 20 张原图、20 段旁白、20 段画面提示词、图片路径对应关系和全部 CRC；下载文件为 58,258,993 字节。
- 阅读页点击「从头看」后从第 20 幅返回第 1 幅；默认尺寸和 375×812 窄屏下检查排列。最终描边按钮样式在默认尺寸截图确认，临时视口覆盖已恢复。
- `git diff --check` 通过；本次验证为相关检查与浏览器操作，未运行完整测试套件。

## Notes

- 增加固定版本依赖 `fflate@0.8.2` 并同步 pnpm 锁文件；原图已压缩，ZIP 使用存储模式以避免再次压缩的开销。打包使用浏览器内存，超大故事仍受设备内存限制。
- 本次为局部、可逆修改，按轻量流程完成；无独立 REQ/AP 或 E2E 规格。验收依据是本次会话中确认的最终要求。
- 没有 Docker 构建、桌面准备或打包、部署、推送、数据库变更。

## Final acceptance review

VR passed: all acceptance criteria complete

- Complete — 结束页下载入口统一为 PDF、PNG、ZIP；浏览器显示三种格式及用途说明。
- Complete — ZIP 包含完整分镜和按顺序编号的原图；17 项相关测试及实际 20 幅故事下载核验通过。
- Complete — 「从头再看」与「开启下一篇」位置互换；两个反馈按钮及前端状态、样式已移除，结束页截图确认。
- Complete — 阅读页在上一幅左侧提供「从头看」按钮；返回第一幅行为和最终描边、背景样式已确认。

Evidence limits: 未验证物理手机、打包桌面应用或所有浏览器；最终按钮样式只在默认尺寸复核，375px 布局检查发生在最后一次边框和内边距调整之前。现有 PDF/PNG 导出实现未改写，相关回归检查通过，本次实际下载核验针对 ZIP。

VR risk: low — 局部界面与浏览器本地导出，重读复用现有行为，无服务端或持久化契约变化。
VR review round: 1; reviewer: not applicable
