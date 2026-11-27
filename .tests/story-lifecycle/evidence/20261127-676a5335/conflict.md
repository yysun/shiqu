# 双窗口并发保存和重放

构建 `676a5335`。Chrome 或 Node 24，正式制作服务、隔离 SQLite、受控模型。

- DAG 12。两个窗口打开同一修订快照，各保存不同的配文。在读者界面同时触发「保存修改」。
- A 创建唯一的新版并停在「等待继续」。B 收到 409，界面保留「窗口 B 的并发草稿」，提供「载入最新版本」。
- 用主流程的并发与重放回归核对暂停胜出版本后重放旧请求的结果。后续暂停保持，当前版本只切换一次，未启动另一次制作。

```json
[
  {
    "id": "af3d1cd7-2c72-4346-a7bd-a144809c3bfe",
    "kind": "revisions",
    "status": 201,
    "versionId": "0b6a0136-885a-4b97-ab61-cfc7a0eaa3d6",
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
    "id": "af3d1cd7-2c72-4346-a7bd-a144809c3bfe",
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
✔ concurrent paused submission replay cannot overwrite a later user control (587.35925ms)
✔ concurrent running submission replay cannot overwrite a later user control (233.44125ms)
✔ scenario 40: restyled image descriptions are valid immediately with the new style (33.992375ms)
✔ a style change converts image descriptions in one batch and redraws, without replanning (38.228834ms)
✔ a hand-edited image description is never repaired automatically (21.55ms)
✔ scenario 34: production structure repair keeps untouched identities and reuses matching retired images (34.921833ms)
✔ production structure repair reports reader attention and leaves protected frames intact (19.540875ms)
✔ ten-frame restyle converts the existing hand edit in one call and clearing regenerates the field (1933.465417ms)
✔ review stops and names the frame when a repair would overwrite its manual description (122.467167ms)
✔ a style change converts image descriptions in one batch, re-reviews frames and redraws every image (315.730167ms)
✔ confirming a lost hand edit once allows the new frame count to replan (166.390709ms)
✔ a revision redraws an unchanged missing frame without inheriting its drawing fault (144.541959ms)
✔ structural preview lists exactly the merged and split frames whose redraw notes will be discarded (103.333834ms)
✔ concurrent revision save handles metadata (305.845292ms)
✔ concurrent revision save handles new revision (160.9925ms)
✔ concurrent revision save handles same request (113.376375ms)
✔ replanning a partially drawn story warns about saved drawings and leaves the new count pending (370.814417ms)
✔ a concurrent revision preserves the open draft and offers the new current story (296.208459ms)
ℹ pass 18
ℹ fail 0
```
