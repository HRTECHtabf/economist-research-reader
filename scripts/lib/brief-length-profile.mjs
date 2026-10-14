export function briefLengthProfile(article = {}) {
  const sourceLength = typeof article.textEn === "string" ? article.textEn.trim().length : 0;

  if (sourceLength > 0 && sourceLength < 500) {
    return {
      kind: "short",
      summaryMin: 50,
      summaryMax: 180,
      pointMin: 18,
      pointMax: 70,
      researchLensMin: 35,
      researchLensMax: 120,
      instruction: [
        `原文是僅 ${sourceLength} 個英文字符的短訊，請依資訊量精簡撰寫，絕對不要為了湊字數補造背景。`,
        "summaryZh 限 50–100 個中文字；keyPointsZh 固定三點，每點 18–45 個中文字；researchLensZh 限 35–70 個中文字。",
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

// 重試時告訴模型「差多少、往哪個方向改」；只寫「摘要長度 118」時，模型常常照原長度重寫，三次都失敗。
export function lengthFeedback(label, length, minimum, maximum) {
  if (length >= minimum && length <= maximum) return null;
  const direction = length < minimum
    ? `太短，需要再補 ${minimum - length} 字以上；請補上原文中已有的具體事實、數字或因果，不要灌水或新增事實`
    : `太長，需要刪減 ${length - maximum} 字以上；請刪除重複與次要細節`;
  return `${label}長度 ${length} 字，${direction}（須介於 ${minimum}–${maximum} 字）`;
}
