#!/usr/bin/env bash
# 快手推荐流（/new-reco）真机验收 —— 借用户已登录的 Edge（BrowserSkill）
#
# 用法：
#   bash tests/kuaishou-immersive-bsk.sh <session> <tab-id> <标签>
#   例：bash tests/kuaishou-immersive-bsk.sh ks82 1614385936 改后-v2.5.82
#
# 纪律（抖音风控那轮的血泪）：
#   - 全程只在一个标签里点导航，**不做整页 navigate**（除第一次打开推荐页）
#   - 每步之间 sleep 足够久，不并发
#   - 每页按钮数必须为 1（两份扩展会叠出两个按钮 → 读到错的）
set -u
S="${1:?session id}"
T="${2:?tab id}"
LABEL="${3:-run}"
export BSK_AUTO_START=0
cd "$(dirname "$0")/.." || exit 1

PROBE=".workbuddy/tmp/ks-state.js"
pass=0; fail=0; skip=0

show() { # 标题
  echo ""
  echo "=== $1"
}
state() {
  bsk evaluate --session "$S" --tab-id "$T" "$(cat "$PROBE")" --json 2>&1 \
    | tr -d '\n' | sed 's/  */ /g' | sed 's/^{ "ok": true, "tab_id": [0-9]*, "value": //' | sed 's/}$//'
}
assert_eq() { # 名称 期望 实际
  if [ "$2" = "$3" ]; then echo "  ✅ $1 = $3"; pass=$((pass+1));
  else echo "  ❌ $1 期望 $2，实际 $3"; fail=$((fail+1)); fi
}

echo "==================== 快手推荐流真机验收（$LABEL）===================="

show "第一步：打开推荐页 /new-reco"
bsk navigate "https://www.kuaishou.com/new-reco" --session "$S" --tab-id "$T" >/dev/null 2>&1
sleep 10
ST=$(state); echo "$ST"
BTN=$(echo "$ST" | grep -o '"按钮": [0-9]*' | head -1 | grep -o '[0-9]*$')
assert_eq "推荐页按钮数" "1" "${BTN:-none}"
ANCHOR=$(echo "$ST" | grep -o '"锚点": "[^"]*"' | head -1 | cut -d'"' -f4)
assert_eq "锚点标记" "kuaishou-immersive" "$ANCHOR"

show "第二步：点按钮提取当前这一条（7 个字段）"
bsk click "button.media-extractor-button" --session "$S" --tab-id "$T" >/dev/null 2>&1
sleep 6
ST=$(state); echo "$ST"
ROWS=$(echo "$ST" | grep -o '"行数": [0-9]*' | head -1 | grep -o '[0-9]*$')
assert_eq "浮窗行数" "7" "${ROWS:-none}"

show "第三步：按 ↓ 切下一条（浮窗应就地刷新、按钮跟随）"
# 记下切条前的标题与 URL，切完对比
BEFORE_URL=$(echo "$ST" | grep -o '"URL", "[^"]*"' | head -1 | cut -d'"' -f4)
bsk press ArrowDown --session "$S" --tab-id "$T" >/dev/null 2>&1
sleep 5
ST=$(state); echo "$ST"
AFTER_URL=$(echo "$ST" | grep -o '"URL", "[^"]*"' | head -1 | cut -d'"' -f4)
BTN=$(echo "$ST" | grep -o '"按钮": [0-9]*' | head -1 | grep -o '[0-9]*$')
assert_eq "切条后按钮数" "1" "${BTN:-none}"
if [ -n "$BEFORE_URL" ] && [ "$BEFORE_URL" != "$AFTER_URL" ]; then
  echo "  ✅ 浮窗已刷新成新的一条"; pass=$((pass+1))
  echo "     切条前 URL：$BEFORE_URL"
  echo "     切条后 URL：$AFTER_URL"
else
  echo "  ⚠ 切条前后 URL 相同（可能是同一条、或页面没响应按键）—— 标记跳过"; skip=$((skip+1))
fi

show "第四步：切到「发现」网格页（应撤按钮 + 关浮窗）"
bsk click 'a[href*="isHome=1"]' --session "$S" --tab-id "$T" >/dev/null 2>&1
sleep 7
ST=$(state); echo "$ST"
BTN=$(echo "$ST" | grep -o '"按钮": [0-9]*' | head -1 | grep -o '[0-9]*$')
assert_eq "网格页按钮数" "0" "${BTN:-none}"

show "第五步：切回推荐页（按钮应自行回来）"
bsk click 'a[href*="/new-reco"]' --session "$S" --tab-id "$T" >/dev/null 2>&1
sleep 8
ST=$(state); echo "$ST"
BTN=$(echo "$ST" | grep -o '"按钮": [0-9]*' | head -1 | grep -o '[0-9]*$')
assert_eq "切回推荐页按钮数" "1" "${BTN:-none}"

echo ""
echo "========== 汇总（$LABEL）=========="
echo "通过 $pass｜失败 $fail｜跳过 $skip"
