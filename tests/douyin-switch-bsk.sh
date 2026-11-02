#!/usr/bin/env bash
# 真机：抖音标签切换矩阵（借用户已登录 Edge，走 BrowserSkill / bsk）
#
# 用法:
#   bash tests/douyin-switch-bsk.sh <session_id> <tab_id> [标签:改前|改后]
#
# 判读: 「切后」一行里 btn 应为 1、anchor=douyin-immersive、acts 里只有本条带几何。
#       若 btn=0 且 acts 出现 0x0 残影 → 就是 v2.5.80 的老毛病。
set -u
SID="${1:?需要 session_id}"
TAB="${2:?需要 tab_id}"
TAG="${3:-实测}"
export BSK_AUTO_START=0

SEL_REC='a[href*="recommend=1&from_nav=1"]'
SEL_FOL='a[href*="follow?from_nav=1"]'
SEL_FRI='a[href*="friend?from_nav=1"]'
SEL_JX='a[href*="/jingxuan?from_nav=1"]'
STATE="$(dirname "$0")/../.workbuddy/tmp/state.js"

state() {
  bsk evaluate --session "$SID" --tab-id "$TAB" "$(cat "$STATE")" --json 2>/dev/null \
    | tr -d '\n' | sed 's/  */ /g' \
    | sed -E 's/.*"value": \{//; s/\}.*//' \
    | sed -E 's/"url": ?"([^"]*)"/url=\1/; s/"btn": ?([0-9]+)/btn=\1/; s/"anchor": ?"([^"]*)"/anchor=\1/; s/"fw": ?(true|false)/浮窗=\1/; s/"actCount": ?([0-9]+)/act数=\1/'
}

fresh() {  # $1=url
  bsk navigate "$1" --session "$SID" --tab-id "$TAB" >/dev/null 2>&1
  sleep 9
}

go() {     # $1=css selector
  bsk click "$1" --session "$SID" --tab-id "$TAB" >/dev/null 2>&1
  sleep 8
}

echo "## 抖音切标签真机矩阵（$TAG）  $(date '+%H:%M:%S')"
echo
echo "| 步骤 | 状态 |"
echo "|---|---|"

# 1) 关注 → 朋友
fresh "https://www.douyin.com/follow"
echo "| 关注页(加载) | $(state) |"
go "$SEL_FRI"
echo "| 点朋友 → | $(state) |"

# 2) 朋友 → 关注
fresh "https://www.douyin.com/friend"
echo "| 朋友页(加载) | $(state) |"
go "$SEL_FOL"
echo "| 点关注 → | $(state) |"

# 3) 关注 → 推荐 → 精选（连续两个来回，不刷新）
fresh "https://www.douyin.com/follow"
echo "| 关注页(加载) | $(state) |"
go "$SEL_REC"
echo "| 点推荐 → | $(state) |"
go "$SEL_JX"
echo "| 点精选 → | $(state) |"
go "$SEL_REC"
echo "| 点推荐(回) → | $(state) |"

# 4) 朋友 → 推荐 → 朋友（再一轮，确认不会越切越坏）
fresh "https://www.douyin.com/friend"
echo "| 朋友页(加载) | $(state) |"
go "$SEL_REC"
echo "| 点推荐 → | $(state) |"
go "$SEL_FRI"
echo "| 点朋友(回) → | $(state) |"
