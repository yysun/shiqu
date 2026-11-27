# 逐条修订

构建 `676a5335`，Chrome / 真实读者组件和正式 API / 隔离 SQLite / 受控文字模型。

- 第 2 幅「自动修改」只返回画面描述，创建独立新版。界面显示「已保存，等待继续」，绘图行显示「等待审片通过」。
- 第 3 幅「应用修订建议」更新旁白，保留原草稿的手写画面描述。界面先提示「建议已填入草稿，请核对后保存」。点「保存修改」才创建新版。
- 「自动修改结语」收到原文时提示「建议没有产生实际变化，可手动修改」，无保存请求。
- 旧快照与过期意见返回 409，两种无效请求均未调用模型。三个字段写回和零模型调用的边界由[候选集成断言](../../../story-lifecycle/evidence/20261127-676a5335/issue-routing.md)核对。这里的零调用指应用建议后的复核与绘图；生成建议本身执行一次定向文字调用。

```json
{
  "observed": [
    {
      "id": "f224efe6-8380-4f33-b565-83a1e450f746",
      "kind": "revisions/suggestion",
      "status": 200,
      "field": "prompt",
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
      "id": "f224efe6-8380-4f33-b565-83a1e450f746",
      "kind": "revisions",
      "status": 201,
      "versionId": "af3d1cd7-2c72-4346-a7bd-a144809c3bfe",
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
      "id": "7f1ae82f-d70d-43df-9fd3-dc19f335ea7b",
      "kind": "revisions/suggestion",
      "status": 400,
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
      "id": "7f1ae82f-d70d-43df-9fd3-dc19f335ea7b",
      "kind": "revisions/suggestion",
      "status": 200,
      "field": "caption",
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
      "id": "7f1ae82f-d70d-43df-9fd3-dc19f335ea7b",
      "kind": "revisions",
      "status": 201,
      "versionId": "8df4f7b6-d05a-4f0a-b802-eb5fe3396d56",
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
      "id": "a53d67c0-92bd-4f95-b959-349c4f127b88",
      "kind": "revisions/suggestion",
      "status": 200,
      "field": "reflection",
      "before": {
        "reviews": 5,
        "draws": 0
      },
      "after": {
        "reviews": 5,
        "draws": 0
      }
    }
  ],
  "reviewCount": 5,
  "drawCount": 0
}
```
