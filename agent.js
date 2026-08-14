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

  let KB = {};
  function setKnowledge(kb) { KB = kb || {}; }
  function kb(key) {
    const item = KB[key] || {};
    return [item.text || "知识条目缺失。", item.chips || ["你能回答什么？"]];
  }

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
        "可问：原理、误差、数据处理、界面指标、流程、改进、答辩、γ/YL/标定，或 `droplet_031`。";
    return [text, ["本实验的原理是什么？", "现在的误差如何？", "数据处理怎么做？", "表面张力是多少？"]];
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
    lines.push("\n" + sourceFooter("software+interpretation"));
    return [lines.join("\n"), ["YL数值是多少？", "重复性CV是多少？", "标定尺度对不对？"]];
  }

  function sourceFooter(kind) {
    const mapping = {
      software: "【来源】软件已回传计算结果（转述）。",
      interpretation: "【来源】业务解读（基于规则与当批状态，不是新算 γ）。",
      model: "【来源】模型推演（物理关系说明，不是本批新测值）。",
      external: "【来源】外部公开/定稿参考常数（不是当前样品实测）。",
      "software+interpretation": "【来源】软件计算结果 + 业务解读。",
      "interpretation+model": "【来源】业务解读 + 模型推演。",
    };
    return mapping[kind] || "【来源】混合说明，可追问细分。";
  }

  function yl_q(ctx) {
    const pst = ctx.phys || {};
    const cons = ctx.consistency || {};
    const lines = [];
    if (pst.yl_median != null) {
      lines.push(`**直接回答**：本批 Young–Laplace 中位 γ = **${fmtG(pst.yl_median)}**。`);
      if (pst.poly_median != null) lines.push(`对照：Andreas–Misak（Poly）中位 = **${fmtG(pst.poly_median)}**。`);
      if (pst.rel_yl != null) {
        lines.push(`相对差 |YL−Poly|/Poly ≈ **${Math.round(100 * pst.rel_yl)}%**。`);
        if (pst.rel_yl > 0.12) lines.push("已超过约 12% 一致性门槛 → **不采信 YL 作主值**，报告主值用 Poly。");
      }
      lines.push("");
    } else if (cons.gamma_yl != null) {
      lines.push(`**直接回答**：报告一致性里的 YL = **${fmtG(cons.gamma_yl)}**。`, "");
    } else {
      lines.push("**直接回答**：本批尚未回传可用的 Young–Laplace 数值。", "");
    }
    lines.push(
      "【业务解读】Andreas–Misak 只吃 De、Ds；YL 要拟合**整条轮廓**。" +
        "透明亮场若只剩暗缘空壳+针杆，YL 会漂到错误外形，γ 可差到约一半。" +
        "程序约定：相对差超过约 **12%** 判 YL 失败，回退 Poly。不要把两数平均。"
    );
    lines.push(sourceFooter("software+interpretation"));
    return [lines.join("\n"), ["Poly和YL该信哪个？", "为什么偏差这么大？", "表面张力是多少？"]];
  }

  function cv_value(ctx) {
    const pst = ctx.phys || {};
    const cv = pst.poly_cv;
    let text;
    if (cv == null) {
      text =
        `**直接回答**：当前批次 **${ctx.label}** 还没有可计算的重复性 CV` +
        "（需要物理 JSON 里 ≥2 个有效 Poly γ）。\n\n" +
        "CV = 多帧 Poly 的标准差/均值，表示**重复性分散**，不是与文献的偏差。";
    } else {
      text =
        `**直接回答**：当前 **${ctx.label}** 的重复性 CV = **${(100 * cv).toFixed(2)}%**。\n\n` +
        "含义：多帧 Andreas–Misak γ 的相对分散度。" +
        "CV 大 → 截帧时刻/气流/轮廓波动大；CV 小 → 重复性更好。" +
        "它**不是**与文献偏差，也**不是**扩展不确定度 U。";
      if (pst.poly_median != null) text += `\n本批 Poly 中位 ${fmtG(pst.poly_median)} 可作对照主值。`;
    }
    text += "\n" + sourceFooter("software+interpretation");
    return [text, ["现在的误差如何？", "Poly和YL该信哪个？", "表面张力是多少？"]];
  }

  function polyYlGapPhysics(ctx) {
    const pst = ctx.phys || {};
    const lines = [
      "**直接回答：52% 量级的大偏差，通常不是「液体真的只有一半表面张力」，而是 Poly 与 YL 两个模型读到了不同的几何。**",
      "",
    ];
    if (pst.poly_median != null && pst.yl_median != null && pst.rel_yl != null) {
      lines.push(
        `本批数字：Poly ${fmtG(pst.poly_median)}，YL ${fmtG(pst.yl_median)}，相对差 ≈ **${Math.round(100 * pst.rel_yl)}%。**`
      );
      lines.push("");
    }
    lines.push(
      "【物理/图像根因】",
      "1. **Poly** 只依赖赤道直径 De 与 Ds，对「暗缘空壳」仍可能给出合理主值。",
      "2. **YL** 最小化整条轮廓与 Young–Laplace 外形的残差；亮场透明液滴常只剩暗缘+针，拟合会漂 → γ 可差到约一半。",
      "3. 相对差 >12% 时程序**丢弃 YL**，主值仍用 Poly；不是把文献值硬改成 Poly。",
      "",
      "【不要外推】这不是「测量精度只有 50%」，也不是把 bias、CV、Cred 混成一句话叫误差。"
    );
    lines.push(sourceFooter("interpretation+model"));
    return [lines.join("\n"), ["滴液轮廓残差为什么大？", "Poly和YL该信哪个？", "为什么门控用12%？"]];
  }

  function residualWhy(ctx) {
    const pst = ctx.phys || {};
    let text =
      "**直接回答：轮廓残差大，多半是「图像轮廓 ≠ 真实轴对称准静态外形」，不是公式随便写错一个系数。**\n\n" +
      "【图像层】\n" +
      "- 亮场透明：分割常得到**空心暗缘**或双层边\n" +
      "- 针杆连入轮廓：颈部/底部几何被污染\n" +
      "- 模糊、离焦、运动模糊：边缘抖动\n" +
      "- 非准静态/脱落：不满足静平衡假设，残差必然大\n\n" +
      "【物理层】\n" +
      "- YL 用理论子午线硬贴观测轮廓；轮廓坏了 → 残差↑、γ 漂\n" +
      "- Poly 不走全轮廓残差最小化，所以常出现「Poly 仍稳、YL 残差很大」\n\n";
    if (pst.rel_yl != null && pst.rel_yl > 0.12) {
      text +=
        `本批 Poly–YL 相对差约 **${Math.round(100 * pst.rel_yl)}%**，与「YL 轮廓贴合很差」一致；主值应信 Poly。\n`;
    }
    text +=
      `当前 **${ctx.label}**：usable ${ctx.n_usable}/${ctx.n}。残差问题靠改成像与轮廓，不是放宽门控凑 usable。\n` +
      sourceFooter("interpretation+model");
    return [text, ["为什么偏差这么大？", "Poly和YL该信哪个？", "轮廓门控过了吗？"]];
  }

  function threshold12Explain() {
    const text =
      "**直接回答：约 12% 是 Poly 与 YL 的一致性门控，不是轮廓 solidity 门槛。**\n\n" +
      "【它管什么】比较 Andreas–Misak γ 与 Young–Laplace γ：" +
      "若相对差超过约 **12%**，判 YL 失败，**主值回退 Poly**。\n\n" +
      "【为什么是经验 12%】亮场空心下 YL 常出现 30%～50%+ 相对差；需要可答辩硬规则，避免两数平均。" +
      "12% 是**历史经验/可调工程阈值**，不是物理常数。\n\n" +
      "【别和轮廓门控混淆】usable 看的是 solidity≥0.82、fill_ratio≥0.85 等，是另一道门。\n" +
      sourceFooter("interpretation+model");
    return [text, ["Poly和YL该信哪个？", "轮廓门控过了吗？", "滴液轮廓残差为什么大？"]];
  }

  function trustWhich(ctx) {
    const pst = ctx.phys || {};
    const lines = ["**结论先说：主结果信 Andreas–Misak（Poly）；YL 只作校验，失败就丢掉，不要平均。**", ""];
    if (pst.poly_median != null) lines.push(`- 本批建议采信的主值：**${fmtG(pst.poly_median)}**（Poly 中位）`);
    if (pst.yl_median != null) {
      lines.push(
        `- YL 中位：${fmtG(pst.yl_median)}` +
          (pst.rel_yl != null ? `（相对差 ${Math.round(100 * pst.rel_yl)}%）` : "")
      );
    }
    if (pst.rel_yl != null && pst.rel_yl > 0.12) {
      lines.push("- 决策：相对差 >12% → **明确不信 YL**，报告写 Poly。");
    } else if (pst.rel_yl != null) {
      lines.push("- 决策：相对差未过 12% → YL 可作交叉参考，主值仍以 Poly 写报告。");
    } else {
      lines.push("- 决策：缺 YL 回传时，只信已回传的 Poly；不要用 AI「猜」折中值。");
    }
    lines.push(
      "",
      "【现象】两数差很大。",
      "【原因】YL 吃全轮廓，亮场空壳+针时外形漂；Poly 只吃 De/Ds，更稳。",
      "【风险】信 YL 或平均 → 绝对值可错到约一半。",
      "【建议】信 Poly；改善背光/分割/只选准静态 usable 帧。"
    );
    if (ctx.n_usable === 0) {
      lines.push(
        "\n另：usable=0 仍看到的 γ 多为**离线物理复算**，不是助手门控放行主结果；报告必须分开写。"
      );
    }
    lines.push(sourceFooter("interpretation"));
    return [lines.join("\n"), ["为什么偏差这么大？", "usable=0该信哪个？", "表面张力是多少？"]];
  }

  function scaleWhatIf() {
    const text =
      "**直接回答（模型推演，不是本批新算的 γ）：**\n\n" +
      "量级上 **γ ∝ Δρ · g · (De_物理)²**，De_物理 = De_像素 × px2mm，故 **γ ∝ (px2mm)²**。\n\n" +
      "- 尺子偏大 **x%** → γ 大约偏大 **≈2x%**\n" +
      "- 尺子偏小 8% → γ 大约偏低约 **16%**\n" +
      "- 尺子标成约 2 倍 → γ 可到约 **4 倍**（如冲到 270+）\n\n" +
      "这是尺度误差传播；**我不会因此改写你当前批次的已算 γ**。要核对本批尺子，请问「标定尺度对不对」。\n" +
      sourceFooter("model");
    return [text, ["标定尺度对不对？", "现在的误差如何？", "表面张力是多少？"]];
  }

  function isExternalPropertyQ(q) {
    if (["理论值", "标准值", "文献值", "手册", "公开物性", "物性常数", "标准表面张力"].some((k) => q.includes(k))) return true;
    if (/(纯水|水|乙醇|酒精|盐水).{0,12}(理论|标准|文献)/.test(q)) return true;
    if (/(理论|标准|文献).{0,12}(纯水|表面张力)/.test(q)) return true;
    return false;
  }

  function externalProperty(q, ctx) {
    const wantWater = ["纯水", "水", "water"].some((k) => q.toLowerCase().includes(k.toLowerCase()) || q.includes(k)) &&
      !q.includes("盐水") && !q.includes("乙醇") && !q.includes("酒精");
    const wantEtoh = ["乙醇", "酒精", "ethanol"].some((k) => q.toLowerCase().includes(k) || q.includes(k));
    const wantSaline = ["盐水", "生理盐水", "saline"].some((k) => q.toLowerCase().includes(k) || q.includes(k));
    const t25 = q.includes("25");
    const t30 = q.includes("30");
    const lines = [
      "**这是外部公开物性/常用参考值查询，不是当前打开样品的测量结果。**",
      `（你左侧当前批次是 **${ctx.label}**，下面数字**不会**自动替换成该批 Poly。）`,
      "",
    ];
    if (wantWater && t25) lines.push("**直接回答：25°C 纯水表面张力理论/手册常用参考约 72.0 mN/m（量级；精确值随文献略有出入）。**");
    else if (wantWater && t30) lines.push("**直接回答：30°C 纯水常用参考约 71.2 mN/m 量级（温度升高，γ 下降）。**");
    else if (wantWater) lines.push("**直接回答：纯水表面张力随温度升高而下降；20°C 常用约 72.8 mN/m，25°C 约 72.0，30°C 约 71.2。**");
    else if (wantEtoh) lines.push("**直接回答：本作品乙醇水溶液定稿对照 γ = 25.03 mN/m（报告口径）。** 任意浓度请查专用物性表。");
    else if (wantSaline) lines.push("**直接回答：本作品生理盐水定稿对照 γ = 72.21 mN/m。** usable=0 时若来自离线复算，报告必须写明。");
    else lines.push("**直接回答：我可以给出常用参考量级，但不能把「当前样品测量值」说成理论值。**");
    lines.push(
      "\n常用对照表：",
      "- 纯水 · 20°C：约 **72.8** mN/m",
      "- 纯水 · 25°C：约 **72.0** mN/m",
      "- 纯水 · 30°C：约 **71.2** mN/m",
      "- 乙醇水溶液（作品定稿）：**25.03** mN/m",
      "- 生理盐水（作品定稿）：**72.21** mN/m",
      "\n若要本批**软件已算**的 Poly/YL，请明确问「这一批表面张力是多少」或「YL 数值是多少」。",
      sourceFooter("external")
    );
    return [lines.join("\n"), ["这一批表面张力是多少？", "报告里的标准结果是多少？", "现在的误差如何？"]];
  }

  function usable0Trust(ctx) {
    const g = ctx.phys && ctx.phys.poly_median;
    const lines = [
      "**结论：usable=0 时，不要把界面/报告里的 γ 当成「助手已放行的主结果」。**",
      "",
      "【决策逻辑】",
      "1. **usable**：AI 轮廓/状态门控是否允许进入正式物理链路。usable=0 = 门控全部否决。",
      "2. **仍出现的 γ**：通常来自 MATLAB **离线复算**（或历史定稿表），与门控放行统计不是同一可信层级。",
      "3. **该信谁**：过程结论以门控为准；离线 γ 若引用须标注「离线重算 / 未过助手门控」。",
      "4. **禁止**：放宽门槛凑数，或让 AI 另猜一个 γ。",
      "",
      `当前打开：**${ctx.label}**，usable **${ctx.n_usable}/${ctx.n}**。`,
    ];
    if (g != null) lines.push(`本批 JSON 中位 Poly = ${fmtG(g)}（物理回传；是否作文正式主结果取决于 usable 与报告口径）。`);
    if (String(ctx.folder || ctx.label || "").includes("盐") || String(ctx.folder || "").toLowerCase().includes("salt")) {
      lines.push("生理盐水定稿表常见 72.21 mN/m：若 usable=0，属于离线口径，须在报告写清。");
    }
    lines.push(sourceFooter("interpretation"));
    return [lines.join("\n"), ["轮廓门控过了吗？", "Poly和YL该信哪个？", "报告里的标准结果是多少？"]];
  }

  function sourceAttribution() {
    const text =
      "**直接回答：可以按四类区分我说的内容来源。**\n\n" +
      "1. **软件计算结果**：JSON/xlsx 已有数——Poly/YL 中位、CV、ylOk、usable、Cred、px2mm、最佳帧名。\n" +
      "2. **业务解读**：如「该信 Poly」「usable=0 不能当放行主结果」「下一步先改光路」。\n" +
      "3. **模型推演**：如 γ∝(px2mm)²、空心轮廓导致 YL 残差变大、12% 一致性门控。\n" +
      "4. **外部公开常数/定稿表**：如 25°C 纯水约 72 mN/m、定稿 71.78/25.03/72.21；**不是**当前打开样品实时测量。\n\n" +
      "我是规则助手，不调用大模型，也**不会**根据图像自己预测一个新的 γ。\n" +
      sourceFooter("interpretation");
    return [text, ["YL数值是多少？", "25°C纯水理论值是多少？", "尺子标错了γ怎么变？"]];
  }

  function capabilityBoundary() {
    const text =
      "我能说的内容分四类（边界是**标明来源**，不是什么都不说）：\n\n" +
      "- **软件计算结果**：转述本批已有 γ/CV/usable/Cred；不现场重算新的 γ\n" +
      "- **业务解读**：该信谁、风险、下一步；不编造未回传的数\n" +
      "- **模型推演**：公式量级、误差传播、残差机理；不把推演写成「本批测得」\n" +
      "- **外部常数**：手册/定稿参考；不用参考值冒充当前样品\n";
    return [text, ["你刚才哪些是算出来的？", "25°C纯水理论值是多少？", "Poly和YL该信哪个？"]];
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
    return [text, ["整个实验流程是怎样的？", "有什么改进之处？", "老师会怎么问？"]];
  }

  function improve(ctx) {
    const pst = ctx.phys || {};
    const lines = [
      `针对 **${ctx.label}**，可改进方向按优先级：`,
      "",
      "1. **尺子（影响最大）** γ∝(px2mm)²。确认分析图宽与标定 JSON 一致，三种液体不串用标定。",
      "2. **拍摄与分割** 用亮场原图；保证针+整滴在 ROI；空心轮廓靠填洞+切针，不要放宽门控凑 usable。",
      "3. **选帧** 正式算 γ 只用「准静态且 usable」；脱落帧应拦截。",
      "4. **双模型** 主值永远是 Andreas–Misak（Poly）；YL 仅校验，差过约 12% 就丢掉，不要平均。",
      "5. **温度对比** 25/30°C 分目录、分 xlsx，禁止两温度共用一批图。",
    ];
    if (ctx.n_usable === 0) lines.push("\n这批 usable=0：优先改善背光均匀与针/滴完整入画，而不是改门槛。");
    else if (ctx.usable_rate < 0.5) lines.push(`\n这批 usable 仅 ${pct(ctx.usable_rate)}：先看脱落是否该拦、轮廓是否空心。`);
    if (pst.rel_yl != null && pst.rel_yl > 0.12) lines.push("\n这批 YL 与 Poly 差过 12%：属亮场空心轮廓常见现象，改进在分割/光路，不是改公式硬凑。");
    if (pst.poly_median == null) lines.push("\n还没有物理回传：先跑通 MATLAB 再谈数值改进。");
    lines.push("\n**不要做的事**：用文献 γ 反推标定、放宽 solidity/fill 门槛、把 Cred/bias 当成准确度、给 AI 直接预测 γ。");
    return [lines.join("\n"), ["我下一步该做什么？", "标定尺度对不对？", "老师会怎么问？"]];
  }

  function hardware() {
    const text =
      "本实验硬件口径（报告保持一致）：\n\n" +
      "- 针：17G，外径 **1.47 mm**（标定尺子）\n" +
      "- 成像：亮场；针与整滴需拍全\n" +
      "- 成本量级约 **1634 元**（以报告为准）\n" +
      "- AI 侧否决率约 40%；乙醇脱落拦截示例 10/10\n\n" +
      "换针规格必须重标定；不能拿 1 cm 尺子随便标完就去算 γ。";
    return [text, ["标定尺度对不对？", "整个实验流程是怎样的？"]];
  }

  function reportNumbers() {
    const text =
      "报告对外数字请保持一致（勿与旧 xlsx 混用）：\n\n" +
      "- 纯水：γ = **71.78** mN/m（约 +0.82%，CV 5.31%，U≈5.44）\n" +
      "- 乙醇水溶液（75%）：γ = **25.03** mN/m（约 −1.84%，CV 2.10%）\n" +
      "- 生理盐水：γ = **72.21** mN/m（约 +1.13%；若 usable=0% 须写明为离线重算）\n" +
      "- Cred 示例约 92 / 81 / 61（过程分，不是准确度）\n\n" +
      "左侧批次若显示当前 JSON 的中位数，以当前批次回传为准；写报告时用上面定稿表。";
    return [text, ["表面张力是多少？", "可信度为什么不是 90 分？"]];
  }

  function defense() {
    const text =
      "答辩高频问答口径：\n\n" +
      "**Q：AI 怎么算表面张力？**\nA：不算。AI 观察/选帧/门控；γ 由 Andreas–Misak 算。\n\n" +
      "**Q：YL 差一半是不是失败？**\nA：亮场空心轮廓时常见。相对差 >12% 丢 YL，主值仍用 Poly。\n\n" +
      "**Q：Cred 92 是不是很准？**\nA：不是。Cred 是过程质量；精度看 U、CV 与文献偏差。\n\n" +
      "**Q：是不是用标准值修正作弊？**\nA：禁止用文献 γ 反推 px2mm。尺子来自针径物理标定。\n\n" +
      "**Q：usable=0 怎么办？**\nA：不放宽门槛。可离线复算，但报告必须写明门控否决。\n\n" +
      "**Q：为什么三种液体标定不能共用？**\nA：ROI/图宽/成像几何可能不同，γ 对尺度平方敏感。";
    return [text, ["有什么改进之处？", "YL 为什么差这么多？"]];
  }

  function polyExplain() {
    const text =
      "Andreas–Misak（程序里 Poly）在做什么：\n\n" +
      "1. 从轮廓取最大直径 **De**，以及顶点到 De 平面的距离 **Ds**\n" +
      "2. 形状因子 **S = Ds/De**\n" +
      "3. 用多项式近似得到 1/H(S)，再算 γ = Δρ g De² / H\n\n" +
      "它只依赖两个几何量，对空心亮场仍较稳。Young–Laplace 要拟合整条轮廓，亮场空壳+针时容易漂。所以本实验：**Poly 出主值，YL 只校验**。";
    return [text, ["YL 为什么差这么多？", "表面张力是多少？"]];
  }

  function failureModes(ctx) {
    const text =
      "结果乱跳时，优先查这些（多数不是 Misak 公式错了）：\n\n" +
      "- **γ 变成 270+/300+**：px2mm 标大了约一倍，或串用了其他液体标定（γ∝尺度²）\n" +
      "- **水变成约 61**：图宽与标定宽不一致（例如 812 vs 406）再被尺度守卫压偏\n" +
      "- **77～80 偏高**：针被算进轮廓，或温度参考用错\n" +
      "- **25°C 与 30°C 小数完全一样**：读了同一批结果/修正过度\n" +
      "- **usable 很低**：空心轮廓、针连滴、脱落帧未拦\n\n" +
      `当前批次 **${ctx.label}**：usable ${ctx.n_usable}/${ctx.n}，Cred ${Math.round(ctx.cred)}。` +
      "要针对本批改，请问「我下一步该做什么」或「有什么改进之处」。";
    return [text, ["有什么改进之处？", "标定尺度对不对？"]];
  }

  function temperatureQ(ctx) {
    const text =
      "温度对比规则：\n\n" +
      "- 目录：`water_vedio\\25` 与 `\\30`，酒精/盐水同理\n" +
      "- 结果文件：`droplet_results_T25.xlsx` / `T30.xlsx`，禁止混用\n" +
      "- 物理上温度升高，表面张力一般**下降**\n" +
      "- 每种液体用自己的标定 JSON\n\n" +
      `你现在打开的是 **${ctx.label}**。换温度请在左侧改批次，不要把另一温度的图丢进当前目录。`;
    return [text, ["报告里的标准结果是多少？", "这次结果怎么样？"]];
  }

  function helpMenu(ctx) {
    const text =
      `当前批次：**${ctx.label}**。你可以这样问我：\n\n` +
      "- **原理**：本实验原理、悬滴法、Misak/YL、几何量 De/Ds\n" +
      "- **误差**：现在的误差如何、误差来源、不确定度/CV/bias/Cred 区别\n" +
      "- **数据处理**：截帧、标定、AI 门控、MATLAB、全流程\n" +
      "- **界面**：usable、Cred、γ、最佳帧、左侧指标什么意思\n" +
      "- **本批**：怎么样、轮廓、状态、γ、YL、标定、下一步、改进\n" +
      "- **答辩/报告**：老师会怎么问、定稿数字、硬件成本\n" +
      "- **单帧**：`droplet_031`\n\n" +
      "我是规则助手，不调用大模型，也**不预测** γ。";
    return [text, ["本实验的原理是什么？", "现在的误差如何？", "数据处理怎么做？", "界面上这些数是什么意思？"]];
  }

  function aiLimit() {
    const text =
      "关于「再加大模型/神经网络让 γ 更准」：\n\n" +
      "本作品口径是 **AI 管过程，物理模型管数值**。用网络去拟合文献 γ，或拿 ADSA 自己当标签训练，评委容易认为循环论证/黑箱凑数。\n\n" +
      "该做的智能化：状态识别、选帧、轮廓门控、异常诊断、对话解释。不该做的：AI 直接输出 γ、用标准值反推标定。";
    return [text, ["老师会怎么问？", "有什么改进之处？"]];
  }

  function salineNote(ctx) {
    const text =
      "生理盐水特别提醒：若助手门控 **usable=0%**，报告里的 γ=72.21 属于**离线重算**，不是助手放行后的结果，必须写清楚。\n\n" +
      "不要为了出数放宽轮廓门槛。" +
      `当前打开的是 **${ctx.label}**（usable ${ctx.n_usable}/${ctx.n}）。`;
    return [text, ["轮廓门控过了吗？", "报告里的标准结果是多少？"]];
  }

  function principle() { return kb("principle"); }
  function dataProcessing() { return kb("data_processing"); }
  function errorSources() { return kb("error_sources"); }
  function geometryQ() { return kb("geometry"); }
  function extractQ() { return kb("extract"); }
  function matlabQ() { return kb("matlab"); }

  function uiHelp(ctx) {
    const [base, chips] = kb("ui_help");
    const g = ctx.phys && ctx.phys.poly_median;
    const text =
      base +
      `\n\n**当前批次快照**：${ctx.label}；usable ${ctx.n_usable}/${ctx.n}；` +
      `Cred ${Math.round(ctx.cred)}；γ=${fmtG(g)}；最佳帧 \`${ctx.best || "—"}\`。`;
    return [text, chips];
  }

  function errorAnalysis(ctx) {
    const pst = ctx.phys || {};
    const lines = [`**${ctx.label}** 的误差/对照，我按当批已回传量说明（不另算新的 γ）：`, ""];
    if (pst.poly_median == null) {
      lines.push("还没有物理回传中位数，无法谈与文献偏差或 CV。请先跑 MATLAB 并回传 JSON。");
      lines.push("不过误差来源仍可先看：尺子、轮廓、密度温度、重复性——请问「误差来源有哪些」。");
      return [lines.join("\n"), ["误差来源有哪些？", "数据处理怎么做？", "表面张力是多少？"]];
    }
    lines.push(`- 主值（Poly 中位）：**${fmtG(pst.poly_median)}**`);
    if (pst.gamma_ref != null) {
      const b = pst.bias;
      if (b != null) {
        lines.push(
          `- 相对参考 ${Number(pst.gamma_ref).toFixed(2)} mN/m 的偏差：**${(100 * b).toFixed(2)}%**（对照用，**不是**不确定度 U）`
        );
      } else {
        lines.push(`- 参考值约 ${Number(pst.gamma_ref).toFixed(2)} mN/m`);
      }
    } else {
      lines.push("- 本批 JSON 未带 gamma_ref，文献对照请看报告定稿表。");
    }
    if (pst.poly_cv != null) {
      lines.push(`- 重复性 CV：**${(100 * pst.poly_cv).toFixed(2)}%**（多帧分散，不是与文献差）`);
    }
    if (pst.yl_median != null) {
      const rel = pst.rel_yl;
      lines.push(
        `- YL 中位 ${fmtG(pst.yl_median)}` +
          (rel != null ? `，相对 Poly **${(100 * rel).toFixed(1)}%**` : "") +
          (rel != null && rel > 0.12 ? "；已超约 12% 门槛则**不采信 YL**" : "")
      );
    }
    if (pst.px2mm != null) {
      lines.push(`- 尺度 px2mm = ${Number(pst.px2mm).toFixed(6)}（γ∝其平方，尺子错则整段平移）`);
    }
    lines.push(`- 过程 Cred = ${Math.round(ctx.cred)}/100（${ctx.cred_label || "未标注"}），不改 γ`);
    lines.push(`- 门控 usable = ${ctx.n_usable}/${ctx.n}`);
    lines.push(
      "\n报告定稿里扩展不确定度 U 约百分之几量级（以报告表格为准），请勿把 bias、CV、Cred、U 四个量混成一句话叫“误差”。要系统清单请问「误差来源有哪些」。"
    );
    return [lines.join("\n"), ["误差来源有哪些？", "有什么改进之处？", "标定尺度对不对？", "报告里的标准结果是多少？"]];
  }

  function usableMeaning(ctx) {
    const text =
      `**usable** 表示轮廓/状态门控后允许进入物理计算的帧。当前 **${ctx.label}** 为 **${ctx.n_usable}/${ctx.n}**（${pct(ctx.usable_rate)}）。\n\n` +
      "未 usable 常见原因：非准静态、脱落、空心轮廓、对称差、清晰度/针干扰等。usable=0 不要放宽门槛凑数；盐水若报告仍有 γ，须标明离线重算。";
    return [text, ["为什么有的帧不能用？", "轮廓门控过了吗？", "我下一步该做什么？"]];
  }

  function fallback(ctx) {
    return [
      `我没把握精确理解这句。当前批次是 **${ctx.label}**。\n\n` +
        "请用更直接的问法，例如：「YL 数值是多少」「重复性 CV 是多少」" +
        "「为什么偏差这么大」「残差为什么大」「Poly 和 YL 该信哪个」" +
        "「25°C 纯水理论值」「尺子标错了 γ 怎么变」「哪些是模型算的、哪些是推理」。\n" +
        "不必点菜单；把关键名词说清楚即可。",
      ["YL数值是多少？", "重复性CV是多少？", "Poly和YL该信哪个？", "你刚才哪些是算出来的？"],
    ];
  }

  function bestRule(q) {
    const ql = q.toLowerCase();

    if (
      ["哪些是物理模型", "哪些是你自己", "哪些是推理", "来自模型", "来自推理", "来源区分", "哪些是计算", "哪些是解读", "哪些是算出来", "你自己推理"].some((k) => q.includes(k)) ||
      (q.includes("哪些") && ["模型", "推理", "计算", "解读", "算出来"].some((k) => q.includes(k)))
    ) {
      return "source";
    }
    if (["能力边界", "你能回答什么类型", "四类内容", "区分软件计算"].some((k) => q.includes(k))) return "capability";

    if (isExternalPropertyQ(q)) return "external";

    if (
      (ql.includes("usable") || q.includes("usable=0") || q.includes("usable＝0")) &&
      ["该信", "信哪个", "为什么还", "还显示", "主结果"].some((k) => q.includes(k))
    ) {
      return "usable0";
    }
    if (
      ["该信哪个", "信哪个", "采信", "该信谁", "相信哪个"].some((k) => q.includes(k)) ||
      ((ql.includes("poly") || ql.includes("misak") || ql.includes("yl") || ql.includes("young")) && q.includes("信"))
    ) {
      return "trust";
    }

    if (/\bcv\b/.test(ql) || ql.includes("cv值") || (q.includes("重复性") && (ql.includes("cv") || q.includes("CV") || q.includes("分散")))) {
      return "cv";
    }
    if (q.includes("重复性") && ["多少", "是多少", "现在"].some((k) => q.includes(k))) return "cv";

    if (q.includes("残差")) return "residual";

    if (
      q.includes("12%") ||
      q.includes("12 ％") ||
      q.includes("百分之十二") ||
      /12\s*%/.test(q) ||
      (q.includes("阈值") && q.includes("12")) ||
      (q.includes("门控") && q.includes("12") && q.includes("阈值"))
    ) {
      if (["为什么", "为何", "怎么定", "设定", "而不是"].some((k) => q.includes(k)) || q.includes("12")) {
        return "th12";
      }
    }

    if (
      ["偏差高达", "相对差", "差这么多", "差一半", "为什么差", "相差", "偏差会高"].some((k) => q.includes(k)) ||
      (q.includes("偏差") && ["为什么", "物理", "原因", "52", "50%", "一半"].some((k) => q.includes(k)))
    ) {
      if (!q.includes("文献") && !q.includes("标准")) return "gap";
    }

    if (
      ["尺子标错", "标定错", "px2mm错", "尺度错"].some((k) => q.includes(k)) ||
      ((q.includes("尺子") || q.includes("标定") || ql.includes("px2mm")) &&
        ["怎么变", "会怎么", "如何变", "偏大", "偏小", "若"].some((k) => q.includes(k)))
    ) {
      return "scalewhatif";
    }

    if (
      /(yl|young|laplace|young–laplace|young-laplace).{0,8}(数值|多少|是多少|中位)/i.test(ql) ||
      /(数值|多少).{0,8}(yl|young|laplace)/i.test(ql) ||
      ql.includes("young-laplace法算出来") ||
      q.toLowerCase().includes("young–laplace法算出来")
    ) {
      return "yl";
    }
    if (ql.includes("yl") && ["多少", "数值", "中位", "算出来"].some((k) => q.includes(k))) return "yl";

    if (
      PIPELINE_KEYS.some((k) => q.includes(k)) ||
      (q.includes("流程") && !q.includes("下一步") && !q.includes("处理"))
    ) {
      return "workflow";
    }
    if (/(这一批|本批|当前).{0,6}(γ|gamma|表面张力).{0,6}多少|(γ|gamma|表面张力).{0,6}多少|多少.{0,4}(γ|mN)/i.test(q)) {
      if (!isExternalPropertyQ(q)) return "gamma";
    }

    if (["原理", "悬滴法", "理论基础", "物理图像", "为什么能测"].some((k) => q.includes(k))) return "principle";
    if (["误差来源", "不确定度来源", "误差有哪些", "误差因素"].some((k) => q.includes(k))) return "errsrc";
    if (["现在的误差", "误差如何", "准不准", "不确定度", "精度如何"].some((k) => q.includes(k)) && !q.includes("偏差")) {
      return "error";
    }
    if (["数据处理", "怎么处理", "如何处理", "处理流程", "算法流程", "分析流程"].some((k) => q.includes(k))) return "dataproc";
    if (["界面", "截图", "左侧", "这些数", "显示的是", "工作台"].some((k) => q.includes(k))) return "ui";

    const table = [
      [1, ["你是谁", "你做什么", "ai做什么", "你是什么"], "who"],
      [1, ["你能回答", "能问什么", "会什么", "有哪些问题", "可以问", "能力边界"], "help"],
      [1, ["原理", "悬滴法", "理论基础", "物理图像"], "principle"],
      [1, ["误差来源", "误差因素", "不确定度来源"], "errsrc"],
      [1, ["现在的误差", "不确定度", "准不准", "精度如何"], "error"],
      [1, ["数据处理", "怎么处理", "处理流程", "算法流程"], "dataproc"],
      [1, ["界面", "截图", "左侧指标", "这些数", "工作台", "usable是什么", "usable 是"], "ui"],
      [2, ["改进", "优化", "不足", "怎么更好", "如何提高", "精度不够", "泛化"], "improve"],
      [2, ["老师会问", "老师怎么问", "答辩", "评委", "会怎么问", "高频问", "是不是作弊", "人为修正"], "defense"],
      [2, ["测不准", "为什么错", "乱跳", "偏大", "偏小", "273", "300", "失败模式"], "fail"],
      [2, ["截帧", "滴落检测", "roi", "取帧", "extract"], "extract"],
      [2, ["matlab", "物理反演", "xlsx", "批处理脚本"], "matlab"],
      [2, ["形状因子", "几何量", "赤道直径"], "geometry"],
      [3, ["yl", "young", "laplace"], "yl"],
      [3, ["misak", "andreas", "poly原理", "公式", "怎么算的", "h(s)"], "poly"],
      [3, ["大模型", "神经网络", "cnn", "深度学习", "预测γ", "ai预测"], "ailimit"],
      [4, ["这一批表面张力", "本批表面张力", "gamma", "γ", "主值", "poly中位"], "gamma"],
      [4, ["报告", "定稿", "标准结果", "71.78", "25.03", "72.21"], "report"],
      [4, ["离线重算"], "saline"],
      [4, ["usable", "可用帧"], "usable"],
      [5, ["标定", "尺度", "px2mm", "针径"], "scale"],
      [5, ["17g", "针头", "硬件", "成本", "器材", "1634"], "hardware"],
      [5, ["温度对比", "25度", "30度", "25°", "30°", "升温"], "temp"],
      [6, ["可信度", "cred", "靠谱", "准确度"], "cred"],
      [6, ["轮廓", "拦住", "否决", "不能用", "异常帧"], "contour"],
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
    rules.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    return rules[0][2];
  }

  const FNS = {
    workflow, who, gamma, yl: yl_q, scale: scale_q, cred: credibility,
    contour, states, advice, overview, greet, improve, hardware, report: reportNumbers,
    defense, poly: polyExplain, fail: failureModes, temp: temperatureQ, help: helpMenu,
    ailimit: aiLimit, saline: salineNote, principle, dataproc: dataProcessing, errsrc: errorSources,
    error: errorAnalysis, ui: uiHelp, geometry: geometryQ, extract: extractQ, matlab: matlabQ,
    usable: usableMeaning,
    cv: cv_value, residual: residualWhy, gap: polyYlGapPhysics, th12: threshold12Explain,
    trust: trustWhich, scalewhatif: scaleWhatIf, usable0: usable0Trust,
    source: sourceAttribution, capability: capabilityBoundary,
  };
  const NO_CTX = new Set([
    "who", "hardware", "report", "defense", "poly", "ailimit",
    "principle", "dataproc", "errsrc", "geometry", "extract", "matlab",
    "th12", "scalewhatif", "source", "capability",
  ]);

  function reply(message, ctx) {
    const q = String(message || "").trim();
    if (!q) {
      const [text, suggestions] = greet(ctx);
      return { text, suggestions };
    }
    const fn = bestRule(q);
    if (fn === "external") {
      const [text, suggestions] = externalProperty(q, ctx);
      return { text, suggestions };
    }
    if (fn === "workflow" || NO_CTX.has(fn)) {
      const [text, suggestions] = FNS[fn](ctx);
      return { text, suggestions };
    }
    const fr = findFrame(ctx, q);
    if (fr && !["yl", "cv", "trust", "residual", "gap", "usable0"].includes(fn)) {
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

  global.XuandiAgent = { reply, setKnowledge, bestRule };
})(window);
