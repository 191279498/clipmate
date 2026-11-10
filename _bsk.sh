# bsk 真机小工具：每次动作前自动 cooperate sync 取新的 context / observation
# 用法：source _bsk.sh 后调用
#   bexpr '<js 表达式>'          在当前动作标签里求值
#   bnav <url>                   导航
#   bclick <selector>            点击
#   bshot <文件路径>              截图
#   bsnap                        快照（只打印前 80 行）
#   bstate                       打印当前按钮状态（本项目高频断言）
SESSION=${SESSION:-cbcp}

_sync() {
  _J=$(bsk cooperate sync --session "$SESSION" --json 2>/dev/null)
  CTX=$(printf '%s' "$_J" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.context_id||'')}catch(e){}})")
  OBS=$(printf '%s' "$_J" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.observation_id||'')}catch(e){}})")
}

bexpr() {
  _sync
  bsk evaluate --session "$SESSION" --context "$CTX" --observation "$OBS" "$1" 2>&1
}

bnav() {
  _sync
  bsk navigate --session "$SESSION" --context "$CTX" --observation "$OBS" "$1" 2>&1
}

bclick() {
  _sync
  bsk click --session "$SESSION" --context "$CTX" --observation "$OBS" --selector "$1" 2>&1
}

bshot() {
  _sync
  bsk screenshot --session "$SESSION" --context "$CTX" --observation "$OBS" --out "$1" 2>&1
}

bstate() {
  bexpr "(() => { const b=document.querySelector('.media-extractor-button'); return JSON.stringify({path: location.pathname, has: !!b, inDom: !!(b && b.parentNode), text: b && b.textContent.trim(), skin: b && (b.classList.contains('clipmate-arch')?'arch':'default'), anchor: b && b.getAttribute('data-clipmate-anchor'), title: b && b.title}); })()"
}

# bbtn：只做 sync，从快照文本里抽按钮那行（视频页 DOM 常变，evaluate 的 observation 易失效）
bbtn() {
  _J=$(bsk cooperate sync --session "$SESSION" --json 2>/dev/null)
  printf '%s' "$_J" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const t=(j.observation&&j.observation.text)||'';const lines=t.split('\n').filter(l=>/drag-handle|提取|整理档案/.test(l));console.log(lines.join('\n')||'(快照里没有按钮)');}catch(e){console.log('解析失败')}})"
}
