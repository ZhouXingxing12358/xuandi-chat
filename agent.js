/* 规则引擎：与 Python agent.py 同口径。不预测 γ。 */
(function (global) {
  const TEACHING = {
    NOT_STABLE: ["液滴未进入准静态", "面积/底端仍在变化，外形尚未满足静平衡假设", "等待液滴生长趋缓后再截帧；避免刚滴落后立即取图"],
    LOW_STABILITY: ["稳定程度偏低", "局部窗口内面积波动偏大", "减小气流/振动，或延长等待后再采集"],
    CONTOUR_FAIL: ["轮廓质量不足", "边缘模糊、破损或对称性不足，几何量不可靠", "调整背光均匀性与曝光，清洁针头，重新采集"],
    SHAPE_ASYM: ["形态偏离轴对称", "悬挂液滴模型假设轴对称，偏斜会系统偏差", "检查针头竖直与液滴居中，避免侧风"],
    SCALE_MISMATCH: ["尺度/标定不一致", "针径估计与当前 px2mm 偏差过大", "在同分辨率、同物距、同 ROI 下重新标定针径"],
    WIDTH_MISMATCH: ["图像宽度与标定不一致", "分析图与标定图不是同一成像几何", "确认截帧 ROI/分辨率未改；改过则必须重标定"],
    PHYSICS_INCONSISTENT: ["物理一致性未通过", "Andreas–Misak 与 Young–Laplace 相对偏差偏大", "复核准静态选帧、轮廓与标定；透明样品以形状因子结果为主"],
    LOW_SCORE: ["综合选帧评分偏低", "稳定性/轮廓/清晰度等综合指标不理想", "改善光照与对焦后重采，并检查 usable 清单"],
  };

  const PIPELINE_KEYS = [
    "整个实验流程", "整个实验", "实验流程", "操作流程", "测量流程",
    "怎么做实验", "实验怎么做", "实验是怎么", "怎么做这个", "怎么操作",
    "全过程", "从拍摄", "实验步骤", "操作步骤", "测量步骤", "整套实验",
    "六步", "先拍摄", "实验怎么做的",
  ];

  const fname = (p) => (p || "—").split(/[/\\]/).pop();
  const pct = (x) => (x == null ? "—" : `${Math.round(100 * x)}%`);
  const fmtG = (x) => (x == null ? "尚未回传" : `${Number(x).toFixed(2)} mN/m`);

  function bestFrame(ctx) {
    const name = ctx.best;
    return (ctx.frames || []).find((f) => fname(f.path) === name) || null;
  }

  function findFrame(ctx, text) {
    const m = String(text).match(/droplet[_\s-]*(\d+)/i);
    if (!m) return null;
    const key = `droplet_${String(Number(m[1])).padStart(3, "0")}`;
    return (ctx.frames || []).find((f) => fname(f.path).toLowerCase().includes(key)) || null;
  }

  function greet(ctx) {
    const g = ctx.phys && ctx.phys.poly_median;
    const gtxt = g
      ? `物理侧 Andreas–Misak 中位 γ 约 **${fmtG(g)}**。`
      : "MATLAB 物理结果还没接到，我这边**不会自己估一个 γ**。";
    const text =
      `我是悬滴实验助手。刚读完 **${ctx.label}**：${ctx.n} 张候选帧，` +
      `门控放行 **${ctx.n_usable}** 张（usable ${pct(ctx.usable_rate)}），` +
      `过程可信度 **${Math.round(ctx.cred)}/100**（${ctx.cred_label || "未评价"}）。\n\n` +
      `${gtxt}\n\n` +
      "我只做观察、选帧、轮廓门控和操作建议；表面张力由物理模型算，不由我预测。" +
      "你可以问整套实验怎么做，也可以问这一批能不能算、轮廓怎么了、γ 是多少。";
    return [text, ["整个实验流程是怎样的？", "这次结果怎么样？", "为什么有的帧不能用？", "表面张力是多少？"]];
  }

  function overview(ctx) {
    const st = ctx.states || {};
    const stTxt = Object.keys(st).map((k) => `${k} ${st[k]} 张`).join("、") || "状态未统计";
    const pst = ctx.phys || {};
    const lines = [
      `**${ctx.label}** 我是这样看的：`,
      `- 候选 ${ctx.n} 张，usable **${ctx.n_usable}**（${pct(ctx.usable_rate)}）`,
      `- 状态分布：${stTxt}`,
      `- 最佳评分帧：\`${ctx.best || "—"}\`` + (ctx.best_score != null ? `（${Number(ctx.best_score).toFixed(1)} 分）` : ""),
      `- 可信度：**${Math.round(ctx.cred)}/100**，${ctx.cred_label || ""}`,
    ];
    if (pst.poly_median != null) {
      lines.push(`- 主值（Andreas–Misak 中位）：**${fmtG(pst.poly_median)}**`);
      if (pst.gamma_ref != null) {
        const b = pst.bias;
        const btxt = b != null ? `，相对参考 ${Number(pst.gamma_ref).toFixed(2)} 为 ${(100 * b).toFixed(1)}%` : "";
        lines.push(`- 参考值 ${Number(pst.gamma_ref).toFixed(2)} mN/m${btxt}`);
      }
      if (pst.poly_cv != null) lines.push(`- 重复性 CV ${(100 * pst.poly_cv).toFixed(1)}%（多帧分散程度，不是与文献的偏差）`);
    } else {
      lines.push("- γ：物理 JSON 尚未对接。请先跑 MATLAB，再回来问我。");
    }
    lines.push("\n可信度是过程分，**不是**测量精度 U，也**不会**改 γ。");
    return [lines.join("\n"), ["轮廓门控过了吗？", "YL 和 Misak 差多少？", "最佳帧能用吗？"]];
  }

  function states(ctx) {
    const st = ctx.states || {};
    let text =
      "状态是我根据面积/底端时序标的，不是人工点的。\n\n" +
      `- 准静态 **${st["准静态阶段"] || 0}** 张：接近静平衡，适合进物理反演\n` +
      `- 生长 **${st["生长阶段"] || 0}** 张：还在变大，暂不建议当主结果\n` +
      `- 变化 **${st["变化阶段"] || 0}** 张：过渡段，建议再等\n` +
      `- 脱落 **${st["脱落阶段"] || 0}** 张：已经在掉，几何假设不成立，应拦截\n\n` +
      `这批脱落 ${st["脱落阶段"] || 0} 张，门控放行 ${ctx.n_usable} 张。` +
      "拦截脱落是在行使否决权，说明系统不是一律放行出数。";
    const bf = bestFrame(ctx);
    if (bf && bf.state !== "准静态阶段") {
      text +=
        `\n\n另外：评分最高的 \`${ctx.best}\` 其实处于 **${bf.state}**。` +
        "评分用来挑相对更好的图，**不等于**它已经准静态。" +
        "正式算 γ 请优先用「准静态且 usable」的帧。";
    }
    return [text, ["最佳帧能用吗？", "哪些帧被拦住了？"]];
  }

  function contour(ctx) {
    const frames = ctx.frames || [];
    if (!frames.length) return ["还没有逐帧轮廓评价。请先运行 `python run_ai_pipeline.py`。", ["这次结果怎么样？"]];
    const grades = {};
    const blocked = [];
    frames.forEach((f) => {
      const cq = f.contour_quality || {};
      const g = cq.grade || "未评";
      grades[g] = (grades[g] || 0) + 1;
      if (!f.usable_for_physics) blocked.push([fname(f.path), f.state, g, cq.issues || []]);
    });
    const gtxt = Object.keys(grades).map((k) => `${k} ${grades[k]}`).join("、");
    const text = [
      "轮廓门控看的是闭合、凸度、是否空心、对称，不是看 γ 好不好看。",
      "门槛大约是 solidity≥0.82、fill_ratio≥0.85，综合分低于 55 判「异常」。",
      `这批等级：${gtxt}。usable **${ctx.n_usable}/${ctx.n}**。`,
    ];
    if (ctx.n_usable === 0) {
      text.push(
        "\n**全部被否决。** 常见原因是亮场透明液滴被切成暗缘空壳+针杆。" +
          "不要放宽门槛凑 usable。MATLAB 仍可离线复算，但报告必须写明 usable=0%。"
      );
    } else if (blocked.length) {
      text.push("\n被拦住的典型几张：");
      blocked.slice(0, 5).forEach(([name, state, g, issues]) => {
        text.push(`- \`${name}\`（${state}，${g}）：${issues.length ? issues.join("；") : state || "未达准静态/评分"}`);
      });
      if (blocked.length > 5) text.push(`- ……还有 ${blocked.length - 5} 张`);
    }
    return [text.join("\n"), ["我下一步该做什么？", "可信度为什么不是 90 分？"]];
  }

  function credibility(ctx) {
    const text =
      `这批过程可信度 **${Math.round(ctx.cred)}/100**，评价是「${ctx.cred_label || ""}」。\n\n` +
      "它由稳定、轮廓、清晰度、尺度、对称、多帧重复、Poly–YL 一致性加权，" +
      "**不参与 γ 的数值**。亮场背景太平时，清晰度分往往只有十几，Cred 会停在 70 上下，" +
      "即使轮廓已经优秀。边缘视频清晰度高，Cred 才容易到 90。\n\n" +
      "所以：Cred 低 ≠ γ 测错；Cred 高 ≠ 精度很高。精度看 U 和 CV，对照看与文献偏差。";
    return [text, ["表面张力是多少？", "这次结果怎么样？"]];
  }

  function gamma(ctx) {
    const pst = ctx.phys || {};
    const cons = ctx.consistency || {};
    if (pst.poly_median == null && cons.gamma_poly == null) {
      return [
        "我还没读到 Andreas–Misak 的数。请先在 MATLAB 跑完 `droplet_analysis_pipeline.m`，确认有 `physics_results_for_ai.json`，再问我。\n\n我不会根据图像「猜」一个表面张力。",
        ["这次结果怎么样？"],
      ];
    }
    const med = pst.poly_median != null ? pst.poly_median : cons.gamma_poly;
    const lines = [
      `**${ctx.label}** 主报告值是 Andreas–Misak（程序里叫 Poly）的多帧中位数：`,
      `**${fmtG(med)}**`,
    ];
    if (pst.gamma_ref != null) {
      const b = pst.bias;
      const extra = b != null ? `（${(100 * b).toFixed(1)}%）` : "";
      lines.push(`文献/参考约 ${Number(pst.gamma_ref).toFixed(2)} mN/m${extra}。偏差用来对照，**不是**不确定度 U。`);
    }
    if (pst.poly_cv != null) lines.push(`重复性 CV ${(100 * pst.poly_cv).toFixed(1)}%。`);
    if (pst.px2mm != null) lines.push(`当前 px2mm = ${Number(pst.px2mm).toFixed(6)} mm/px。γ 正比于它的平方，尺子错了绝对值会整段平移。`);
    if (pst.yl_median != null) {
      const rel = pst.rel_yl;
      lines.push(
        `Young–Laplace 中位约 ${fmtG(pst.yl_median)}` +
          (rel != null ? `，相对 Poly 偏差 ${Math.round(100 * rel)}%。` : "。")
      );
      if (rel != null && rel > 0.12) {
        lines.push("超过约 12% 的门槛，**不采信 YL**，主值仍用 Poly。亮场空心轮廓时 YL 差一倍是预期现象，不要把两个数平均。");
      }
    }
    lines.push("\nAI 到此为止：我只转述物理模型已经算出来的数。");
    return [lines.join("\n"), ["YL 为什么差这么多？", "标定尺度对不对？"]];
  }

  function yl_q(ctx) {
    const pst = ctx.phys || {};
    let text =
      "Andreas–Misak 只吃两个直径 De、Ds；Young–Laplace 要拟合**整条轮廓**。" +
      "透明亮场若只留下暗缘空壳和针杆，YL 会漂到另一条形状上，γ 可以差到一半。" +
      "程序约定：相对偏差超过约 **12%** 就判 YL 失败，回退 Poly。\n";
    if (pst.poly_median != null && pst.yl_median != null) {
      const rel = pst.rel_yl;
      text +=
        `\n这批 Poly 中位 ${fmtG(pst.poly_median)}，YL 中位 ${fmtG(pst.yl_median)}` +
        (rel != null ? `，相对差 ${Math.round(100 * rel)}%。` : "。");
    }
    return [text, ["表面张力是多少？", "轮廓门控过了吗？"]];
  }

  function scale_q(ctx) {
    const pst = ctx.phys || {};
    const px = pst.px2mm;
    let text =
      "绝对尺子是针头外径 1.47 mm（17G）。px2mm = 1.47 / 针在图上的像素宽。" +
      "分析图宽必须和标定 JSON 的 image_width 一致，或按宽度换算（宽一倍则 px2mm 减半）。" +
      "γ ∝ (px2mm)²：尺子偏小 8%，γ 会低约 17%。\n不要用文献 γ 反推标定，那是循环论证。";
    if (px != null) {
      text += `\n\n这批记录的 px2mm = **${Number(px).toFixed(6)}** mm/px，相当于针宽约 ${(1.47 / px).toFixed(1)} px。`;
    } else text += "\n\n这批还没有 px2mm 回传。";
    return [text, ["表面张力是多少？", "这次结果怎么样？"]];
  }

  function advice(ctx) {
    const items = [];
    const bf = bestFrame(ctx);
    const codes = new Set();
    const src = bf || (ctx.frames && ctx.frames[0]);
    if (src) (src.anomalies || []).forEach((a) => codes.add(a.code));
    if (ctx.n_usable === 0) items.push("轮廓门控全部否决：先调匀背光、保证针和整滴在 ROI 里，不要改 solidity 门槛凑数。");
    else if (ctx.usable_rate < 0.5) items.push("usable 偏低：检查脱落帧是否该拦、准静态是否够、轮廓是否空心。");
    if (bf && bf.state !== "准静态阶段") items.push(`评分最高帧 \`${ctx.best}\` 不是准静态，算 γ 请改用准静态且 usable 的帧。`);
    const pst = ctx.phys || {};
    if (pst.rel_yl != null && pst.rel_yl > 0.12) items.push("YL 与 Poly 差过 12%：主值用 Misak；要缩小差别需改分割/光路，不是平均两个 γ。");
    if (pst.poly_median == null) items.push("还没有物理回传：在 MATLAB 设对 liquidName 和温度后跑管道，再把 JSON 对接过来。");
    if (!items.length) items.push("可以进入物理反演。核对 px2mm 与图宽一致后，以 Poly 中位数写报告。");
    let text = "建议按这个顺序做：\n" + items.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const extra = [];
    codes.forEach((code) => {
      const card = TEACHING[code];
      if (card) extra.push(`**${card[0]}** — 原因：${card[1]}。操作：${card[2]}`);
    });
    if (extra.length) text += "\n\n针对当前最佳帧的诊断：\n" + extra.join("\n");
    text +=
      "\n\n检查清单：\n" +
      ["□ 针径标定与分析图像宽度一致", "□ 已进入准静态（非生长/脱落瞬间）", "□ 轮廓完整、对称性可接受", "□ usable 帧数量足够做多帧统计", "□ Andreas–Misak 与 Young–Laplace 相对偏差可接受或已说明原因"].join("\n");
    return [text, ["轮廓门控过了吗？", "表面张力是多少？"]];
  }

  function frameTalk(ctx, fr) {
    const cq = fr.contour_quality || {};
    const sc = fr.score || {};
    const name = fname(fr.path);
    const usable = fr.usable_for_physics ? "放行" : "拦截";
    const lines = [
      `这是 \`${name}\`：`,
      `- 状态：**${fr.state || "未知"}**，稳定 ${Math.round(fr.stability_pct || 0)}/100`,
      `- 综合分 ${Number(sc.total || 0).toFixed(1)}（稳${Math.round(sc.stability || 0)}/廓${Math.round(sc.contour || 0)}/对${Math.round(sc.symmetry || 0)}/清${Math.round(sc.sharpness || 0)}）`,
      `- 轮廓 ${Math.round(cq.score || 0)}%（${cq.grade || "未评"}），门控 **${usable}**`,
    ];
    if (cq.issues && cq.issues.length) lines.push("- 问题：" + cq.issues.join("；"));
    const an = (fr.anomalies || [])[0];
    if (an) {
      const card = TEACHING[an.code];
      lines.push(card ? `- 诊断：${card[0]}。操作：${card[2]}` : `- 诊断：${an.message || ""}`);
    }
    return [lines.join("\n"), ["我下一步该做什么？", "这次结果怎么样？"]];
  }

  function workflow(ctx) {
    const text =
      "问的是**整套实验怎么做**，不是这一批的下一步建议。" +
      `当前打开的是 **${ctx.label}**，它只是这条链上已经跑完的一个批次。\n\n` +
      "顺序固定为六步，γ 始终由 Andreas–Misak（程序里 Poly）计算，我只观察、选帧、门控和把结果说清楚。\n\n" +
      "1. **拍摄** 亮场原始视频（不要用边缘预处理片）。17G 针外径 1.47 mm，针和整滴要拍全。\n" +
      "2. **截帧** 用 `extract_droplet_frames.py`：框住针+滴，在每次滴落前约 1 秒存 `droplet_*.png`。输出必须进带温度的目录，如 `alcohol_vedio\\30`。\n" +
      "3. **标定** 在与分析图同宽的截图上点针外缘，得到 px2mm。三种液体各用自己的 JSON，不能串用。γ 正比于 (px2mm)²。\n" +
      "4. **AI 评价** 跑 `run_ai_pipeline.py`：标生长/准静态/脱落，评轮廓，写 `frames_manifest.json`。usable=0 是门控否决，不要放宽门槛凑数。\n" +
      "5. **物理反演** 打开 MATLAB `droplet_analysis_pipeline.m`，只改 `liquidName` 和 `temperatureC`。主值取 Poly 中位数；Young–Laplace 只做校验，相对差超过约 12% 就丢掉 YL。\n" +
      "6. **回传与查询** MATLAB 写出 `physics_results_for_ai.json` 后，可再跑一遍 AI，或在这个对话页查询当批结论。\n\n" +
      "对比 25/30°C 必须用 `droplet_results_T25.xlsx` / `T30.xlsx`，两温度不能共用同一批图。" +
      "若只想问这一批接下来改哪，请说「我下一步该做什么」。";
    return [text, ["这次结果怎么样？", "标定尺度对不对？", "表面张力是多少？"]];
  }

  function who() {
    const text =
      "我是这个实验里的**智能实验助手**，不是用来回归表面张力的模型。\n\n" +
      "我会：认生长/准静态/脱落、给选帧分、评轮廓并一票否决、诊断异常、给操作建议、在 MATLAB 算完后复核 Poly 与 YL 是否差过 12%。\n\n" +
      "我不会：直接输出 γ、用文献值反推标定、在空心轮廓上放行充数。";
    return [text, ["整个实验流程是怎样的？", "这次结果怎么样？"]];
  }

  function fallback(ctx) {
    return [
      "我可以讲**整套实验步骤**，也可以讲**这一批已经算过的结果**。例如：流程怎么走、能不能算、哪帧被拦、γ 多少、YL 为啥差。也可以点帧名，如 `droplet_031`。\n\n" +
        `当前目录：${ctx.label}。`,
      ["整个实验流程是怎样的？", "这次结果怎么样？", "表面张力是多少？", "我下一步该做什么？"],
    ];
  }

  function bestRule(q) {
    const ql = q.toLowerCase();
    if (PIPELINE_KEYS.some((k) => q.includes(k)) || (q.includes("流程") && !q.includes("下一步"))) return "workflow";
    if (/(γ|gamma|表面张力).{0,6}多少|多少.{0,4}(γ|mN)/i.test(q)) return "gamma";
    const table = [
      [1, ["你是谁", "你做什么", "ai做什么", "你是什么"], "who"],
      [2, ["yl", "young", "laplace", "差这么多", "相差", "为什么差"], "yl"],
      [3, ["表面张力", "gamma", "γ", "主值", "misak", "poly中位"], "gamma"],
      [4, ["标定", "尺度", "px2mm", "针径", "尺子"], "scale"],
      [5, ["可信度", "cred", "靠谱"], "cred"],
      [6, ["轮廓", "门控", "usable", "拦住", "否决", "不能用", "异常帧"], "contour"],
      [7, ["准静态", "生长阶段", "脱落", "状态分布"], "states"],
      [8, ["下一步", "怎么办", "建议我", "检查清单", "接下来"], "advice"],
      [9, ["怎么样", "这次结果", "概况", "总结一下"], "overview"],
      [10, ["你好", "您好", "在吗"], "greet"],
    ];
    const rules = [];
    table.forEach(([pri, keys, fn]) => {
      let hit = 0;
      keys.forEach((k) => {
        if (ql.includes(k.toLowerCase()) || q.includes(k)) hit = Math.max(hit, k.length);
      });
      if (hit) rules.push([hit, -pri, fn]);
    });
    if (!rules.length) return null;
    rules.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
    return rules[0][2];
  }

  const FNS = {
    workflow, who, gamma, yl: yl_q, scale: scale_q, cred: credibility,
    contour, states, advice, overview, greet,
  };

  function reply(message, ctx) {
    const q = String(message || "").trim();
    if (!q) {
      const [text, suggestions] = greet(ctx);
      return { text, suggestions };
    }
    const fn = bestRule(q);
    if (fn === "workflow" || fn === "who") {
      const [text, suggestions] = FNS[fn](ctx);
      return { text, suggestions };
    }
    const fr = findFrame(ctx, q);
    if (fr) {
      const [text, suggestions] = frameTalk(ctx, fr);
      return { text, suggestions, frame: fname(fr.path) };
    }
    if (!fn) {
      const [text, suggestions] = fallback(ctx);
      return { text, suggestions };
    }
    const [text, suggestions] = FNS[fn](ctx);
    return { text, suggestions };
  }

  global.XuandiAgent = { reply };
})(window);
