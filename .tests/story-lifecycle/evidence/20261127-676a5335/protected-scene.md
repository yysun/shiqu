# 保护手改配文和结构修订

构建 `676a5335`。Chrome 或 Node 24，正式制作服务、隔离 SQLite、受控模型。

- DAG 19。第 3 幅手改配文保留，审片返回限制修订该幅的结果。读者状态列出第 3 幅手改问题，未发出旁白修订。
- DAG 43。受控结构修订建议合并第 12 和 13 幅，自动结果被挡下，保留 16 幅和原手改。手动合并预览列出第 12 幅，缺少确认返回 409，确认后另存 15 幅并等待继续，原版保留，绘图 0 次。首轮脚本的确认参数拼写测试错误已在复跑中更正。

```json
[
  {
    "case": "C049",
    "page": 3,
    "structuralCalls": 0,
    "protectedCaption": "手改保留：鲍叔牙停在庭中，一边系好衣带，一边等管仲走近。",
    "readerAttention": [
      {
        "target": "frameVerdict:n3",
        "reason": "hand-edited",
        "pages": [
          3
        ]
      }
    ],
    "blockedVersion": "785456d9-c54c-409a-9e63-f51ea3e4cf05"
  },
  {
    "case": "C049",
    "structurals": 1,
    "previous": "5d63616e-6780-41ef-8620-ef91bf0ad335",
    "readerAttention": [
      {
        "target": "narrativeVerdict:",
        "reason": "hand-edited",
        "pages": [
          12
        ]
      },
      {
        "target": "narrativeVerdict:",
        "reason": "replan"
      }
    ],
    "preview": [
      {
        "page": 12,
        "caption": "手改保留：鲍叔牙停在庭中，一边系好衣带，一边等管仲走近。"
      }
    ],
    "denied": 409,
    "child": "a249f4e6-43d9-4e73-aa2a-32ff5d65f857",
    "childCount": 15,
    "draws": 0
  }
]
```
