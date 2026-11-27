# 关闭、返回及取消保留分镜编辑

构建 `676a5335`。Chrome 或 Node 24，正式制作服务、隔离 SQLite、受控模型。

- 单幅配文和合并草稿分别更改文字。关闭按钮、点击面板外、Esc 与浏览器返回均出现「放弃未保存的输入？」。选择继续编辑后手写文本仍在。
- 合并预览显示「已合并 2 幅，待保存」与「原第 2 幅将移除，保存后生效」。取消后剧本保持打开，第 2 幅仍在，版本编号保持。
- 再预览合并，保存时已有手改须明确确认。读者点「放弃手改并保存」后，新版显示三幅及「已保存，等待继续」。原稿保留，直到继续前绘图 0 次。

```json
[
  {
    "id": "0015bee9-a2f1-447a-a8ef-97a534747fe1",
    "kind": "revisions",
    "status": 409,
    "before": {
      "reviews": 5,
      "draws": 0
    },
    "after": {
      "reviews": 5,
      "draws": 0
    }
  },
  {
    "id": "0015bee9-a2f1-447a-a8ef-97a534747fe1",
    "kind": "revisions",
    "status": 201,
    "versionId": "33c7806a-5ab0-4bfc-b6a3-06c3b0c07752",
    "awaitingContinue": true,
    "before": {
      "reviews": 5,
      "draws": 0
    },
    "after": {
      "reviews": 5,
      "draws": 0
    }
  }
]
```
