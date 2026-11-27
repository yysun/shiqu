# 三个状态保存后等待继续

构建 `676a5335`。Chrome 或 Node 24，正式制作服务、隔离 SQLite、受控模型。

- DAG 13。审片在途、已暂停、已完成的样本均从读者界面修改一条配文，分别创建新版。
- 每个新版在保存后以及刷新重开后显示「已保存，等待继续」。对于有可读图片的完成稿，重开后先进入阅读，再打开故事设置看到此状态。
- 三次继续请求均在刷新确认后才发出，返回 200。审片和绘图的回执计数在保存及等待阶段分别保持 5 和 0。未更改的配文、原版和成图保留的边界由正式服务回归核对。

```json
[
  {
    "id": "4e0721bb-5def-4576-a5e3-525ede8834a8",
    "kind": "revisions",
    "status": 201,
    "versionId": "eb185e59-0ef0-44cb-81fc-b46c8da1aa43",
    "awaitingContinue": true,
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
    "id": "eb185e59-0ef0-44cb-81fc-b46c8da1aa43",
    "kind": "production-control",
    "status": 200,
    "versionId": "eb185e59-0ef0-44cb-81fc-b46c8da1aa43",
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
    "id": "8420445d-6f8c-4b9a-a146-50c329369b4b",
    "kind": "revisions",
    "status": 201,
    "versionId": "3597b751-28b4-4d03-8b1b-a935c36143e1",
    "awaitingContinue": true,
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
    "id": "3597b751-28b4-4d03-8b1b-a935c36143e1",
    "kind": "production-control",
    "status": 200,
    "versionId": "3597b751-28b4-4d03-8b1b-a935c36143e1",
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
    "id": "09c09b48-deba-40b8-b2b7-e190ea343e78",
    "kind": "revisions",
    "status": 201,
    "versionId": "0015bee9-a2f1-447a-a8ef-97a534747fe1",
    "awaitingContinue": true,
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
    "kind": "production-control",
    "status": 200,
    "versionId": "0015bee9-a2f1-447a-a8ef-97a534747fe1",
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

```text
✔ a paused unfinished storyboard can be revised; late work, replay and restart do not resume or overwrite it (353.166541ms)
✔ saving pauses the old version, keeps favorites and valid progress; replay respects later resume and pause (111.957375ms)
✔ edit a caption, save, restart and continue: only the affected review runs and nothing is redrawn (190.9125ms)
✔ preview and save share one calculation: review notes count, hand edits are protected, and neither starts a model call (223.722792ms)
ℹ pass 4
ℹ fail 0
```
