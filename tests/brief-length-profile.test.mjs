import test from "node:test";
import assert from "node:assert/strict";
import { briefLengthProfile } from "../scripts/lib/brief-length-profile.mjs";

test("極短快訊採資訊量相稱的篇幅門檻，避免逼模型灌水", () => {
  const profile = briefLengthProfile({ textEn: "x".repeat(269) });

  assert.equal(profile.kind, "short");
  assert.equal(profile.summaryMin, 50);
  assert.equal(profile.pointMin, 18);
  assert.equal(profile.researchLensMin, 35);
  assert.match(profile.instruction, /不要為了湊字數補造背景/);
});

test("一般文章維持原有嚴格篇幅門檻", () => {
  const profile = briefLengthProfile({ textEn: "x".repeat(500) });

  assert.equal(profile.kind, "standard");
  assert.equal(profile.summaryMin, 130);
  assert.equal(profile.pointMin, 25);
});
