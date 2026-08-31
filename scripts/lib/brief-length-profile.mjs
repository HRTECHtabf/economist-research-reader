export function briefLengthProfile(article = {}) {
  const sourceLength = typeof article.textEn === "string" ? article.textEn.trim().length : 0;

  if (sourceLength > 0 && sourceLength < 500) {
    return {
      kind: "short",
      summaryMin: 70,
      summaryMax: 180,
      pointMin: 18,
      pointMax: 70,
      researchLensMin: 40,
      researchLensMax: 120,
      instruction: [
        `原文是僅 ${sourceLength} 個英文字符的短訊，請依資訊量精簡撰寫，絕對不要為了湊字數補造背景。`,
        "summaryZh 限 70–130 個中文字；keyPointsZh 固定三點，每點 18–45 個中文字；researchLensZh 限 45–90 個中文字。",
      ].join("\n"),
    };
  }

  return {
    kind: "standard",
    summaryMin: 130,
    summaryMax: 250,
    pointMin: 25,
    pointMax: 86,
    researchLensMin: 50,
    researchLensMax: 135,
    instruction: [
      "summaryZh 限 150–230 個中文字；keyPointsZh 依內容使用三至五點，每點嚴格控制在 35–65 個中文字並以完整標點收尾；researchLensZh 限 60–120 個中文字。",
    ].join("\n"),
  };
}
