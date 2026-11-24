# 独立横版印刷

## Summary

横图任务随发起版本保存，在独立队列中执行。继续制作、改画风、改幅数和竖图重绘不改动已发起的套图。7×5 与 Letter PDF 可选择旧套图，使用保存时的标题、幅序和配文，按来源版本核对当前署名。

## Verification

- 在应用内浏览器从五幅新版中选择四幅旧套图，选用第四幅作为封面并成功导出。正式渲染测试核对两个版式只读取所选套图。
- 变更门禁 656 项通过，18 项定向横图回归通过。原生库 27 项通过，类型检查及 lint 通过。
- 独立验证覆盖旧版署名、读者归属和删除、过期控制、重试画幅，以及接续时恢复可读的旧付费图片。

## Notes

CR fixed: export attribution follows the selected set, and legacy Resume rechecks matching paid receipts before dispatch; rerun result passed.

CR risk: non-low — dispatch and historical storage. CR review round: 4; reviewer: reused.

VR passed: all acceptance criteria complete.

- 新横图由读者发起或重试，冻结绘图输入，普通生产改动不触发调用。
- 暂停和恢复独立。旧版授权的独立任务在修订后可继续，删除阻止新派发。
- 旧套图按原幅序与配文导出，当前竖图仍可试排。
- 旧流程接续需要本版任务和匹配输入的证据。重试只读取已授权画幅，采用恢复可读的付费结果。

VR risk: non-low — dispatch and historical storage. VR review round: 1; reviewer: reused.
