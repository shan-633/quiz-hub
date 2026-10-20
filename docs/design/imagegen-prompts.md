# ImageGen 最终提示词

生成模式：内置 image_gen（非 CLI/API）。分类：ui-mockup。

项目输出：student-responsive.png、admin-editor.png。

## 学生端

```text
Use case: ui-mockup
Asset type: high fidelity responsive Chinese physics practice webapp design sheet, student experience.
Primary request: Create a precise polished product UI prototype for a Chinese middle-school physics practice application named “知序”. A large landscape design board on a very pale warm gray background, with three clearly separated flat front-facing device viewport mockups: left desktop home catalog occupying 46% width; middle iPad portrait practice page occupying 34%; right mobile calculation answer page occupying 20%. No physical hands, no perspective, no floating 3D.
Style: production-ready restrained educational software; ink navy typography, forest teal #167D76 primary actions, warm white cards, delicate gray rules, tiny muted orange accents. Strong hierarchy, generous whitespace, clean Chinese sans-serif. Small icons simple outline. Avoid giant promotional hero, cartoons, decorative gradients, excessive rounded pills.
Left desktop home: slim sidebar brand “知序” with subtitle “物理练习”, nav “学习首页” active, “试卷与题库”, “我的作答”, bottom “管理后台”. Main heading “把每一道题，真正弄懂。” with small eyebrow “学习空间”. A modest continue card “继续上次练习” / “力与运动 · 专项练习” / “继续作答”. Below search input “搜索试卷、题库或知识点”; segmented filters “全部”“试卷”“题库”; 2x2 catalog cards with tiny physics line diagrams and titles “力与运动”“电学基础”“浮力专题”“八年级期中模拟”, each metadata “12 道题” and “开始练习”. Header top right “八年级 · 物理”.
Middle iPad practice: header back “力与运动”, badge “已保存”; small numbered question navigation 01–08, 06 active; main white paper-like question card “06 计算题 · 8 分” and Chinese statement about cart distance 120m in 20s, simple thin diagram of cart on horizontal surface with arrow F and v. Subquestions “（1）求小车的平均速度。”“（2）求牵引力做的功。” Answer section tabs “文字与公式”“手写作答”“拍照上传”, handwrite selected. Toolbar black pen, teal pen, eraser, undo, grid toggle; large square-grid writing surface with natural dark handwritten v=s/t=120/20=6 m/s and W=Fs. Bottom small “手写内容会自动保存”, bottom buttons “上一题”“下一题”. Do not show correct answer feedback.
Right mobile: header “计算题” and “已保存”; compact same question above answer; tabs “文字”“手写”“照片”, photos selected; two image thumbnails of handwritten math on paper with delete and page count; dashed add panel camera icon “拍照或选择图片”; small caption “可上传多张，按顺序提交”; sticky bottom button “保存答案”.
Constraints: crisp legible Chinese headings, realistic coherent application controls, clear responsive differences, no invented huge metrics, no watermarks. Design sheet headings outside viewports only “PC · 学习首页”“iPad · 手写作答”“手机 · 拍照作答”. High resolution landscape composition.
```

## 管理员端

```text
Use case: ui-mockup
Asset type: high fidelity Chinese physics question bank administrator webapp product design, landscape.
Primary request: Design the administrator question authoring screen of “知序 · 物理练习”, a reusable block-based question editor with an actual student preview. This is a realistic desktop browser viewport, not a marketing landing page. Large front-facing flat viewport on a light warm gray background. No perspective devices.
Visual style: quiet professional education software, near-black navy text, forest teal #167D76 primary actions, white panels, delicate gray dividers, readable clean Chinese sans-serif, generous spacing, restrained soft corners, tiny orange warning accents. Precise aligned grid.
Layout: slim left navigation column 14%, large block editor column 46%, live student preview column 40%. Header spans editor+preview with breadcrumb “题库管理 / 力与运动 / 编辑题目”, status “草稿”, secondary button “保存草稿”, primary “发布题目”.
Sidebar: brand “知序” / “管理工作台”, navigation “题库管理” active, “试卷管理”, “题目管理”, bottom button “返回学生端”.
Editor: title “编辑实验题”, compact metadata fields “题型：实验题”, “难度：中等”, “总分：6 分”, tags “八年级”“探究滑动摩擦力”.
Segmented section headings “题目内容”“答案与解析” with content selected.
A vertical sequence of bordered reorderable content blocks, each with six-dot drag handle and small label, move-up/down and delete controls:
1 “文字” with textarea “小明用弹簧测力计探究影响滑动摩擦力大小的因素，实验装置如图所示。”
2 “图片” with clean accurate line diagram of a wood block on a rough horizontal tabletop, horizontal spring balance to its right, arrow F pointing right. Image caption input “图 1 实验装置”. Choice “独占一行” selected, “图文并排”.
3 “子问题（1）” with inline blank chips: “实验时，应使木块做 [空 1] 运动，此时示数等于滑动摩擦力的大小。” Underneath little settings for “空 1” and “2 分”.
4 “子问题（2）” with “要探究压力的影响，应控制 [空 2] 不变。” Little “空 2” and “2 分”.
Bottom outlined add-block buttons “＋ 文字”“＋ 图片”“＋ 公式”“＋ 表格”“＋ 子问题”.
Small helper banner “空格编号由系统维护，移动内容不会改变答案关联”.
Right preview: header “学生端实时预览”, device toggle “手机”“iPad”“PC”, mobile selected. Realistic narrow white mobile viewport centered inside light-gray pane. It shows top “03 实验题 · 6 分”, correctly laid out the same Chinese text, line diagram scaled to fit full width, then numbered subquestions with empty text inputs in place of blank chips. No answers shown in preview. Under preview footer “预览与正式答题共用同一套题目渲染器”.
Tiny lower-right readiness checklist with orange line “发布前检查：尚有 1 项未完成” and “请补全标准答案”.
Constraints: all main Chinese labels legible and accurate, no meaningless metrics, no floating decorative charts, do not show answers to students, no watermark, maintain same teal/navy/white identity as student app. Large high resolution landscape composition.
```

