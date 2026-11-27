# 画风转换保留手改及输入匹配

构建 `676a5335`。Chrome 或 Node 24，正式制作服务、隔离 SQLite、受控模型。

- DAG 28。十幅样本有现存手改画面描述，先后换两种画风。每次把手改作为转换输入，一次转换后重审，原手改标识保留。
- DAG 40。生产引擎核验新描述绑定新画风并立即有效。浏览器换画风后的新版显示「画风转换」，接着是「全篇审片」，绘图在后；保存时等待继续。

```text
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
