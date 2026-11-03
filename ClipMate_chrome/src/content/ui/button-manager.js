// 提取按钮管理器
class ButtonManager {
  /** v2.8.5：按钮文字。只有四个地方用到，集中在这里，改文案不用翻全文。 */
  get LABEL_IDLE() { return '提取'; }
  get LABEL_BUSY() { return '提取中'; }
  get LABEL_OK() { return '完成'; }
  get LABEL_BAD() { return '重试'; }

  /**
   * 吉祥物形象（icons/mascot/mascot.png）—— 只有这一张脸。
   *
   * v2.8.6 定稿：表情不再随状态更换，状态改由右下角的角标表达（见 _BADGE）。
   * 头像本身是插画（小机器人举着一张纸），生动感来自那个「举文件」的动作，
   * 换成只剩一张正脸反而变呆板；而四张表情素材要另出，暂时没有。
   * 现在的分工：头像负责「这是什么产品」，角标负责「这一次成功还是失败」。
   *
   * 素材来自重绘工具出的透明 PNG：已泛洪抠掉棋盘格背景、清掉 JPEG 碎白点、
   * 边缘做了半透明羽化，叠在蓝底/绿底/红底上都不会有白边。
   *
   * 页面里的元素用 background-image 引用，不是 <img>：
   * 站点对 img 的全局规则（max-width / object-fit / border-radius / display）
   * 会把这个头像改烂，background 只是背景图，碰不到。
   *
   * ⚠️ 以后接四态表情：把这里改成 { normal, success, error } 三张即可，
   *    _mascotUrl(state) 与 _renderButton 已经带着 state 参数，不用改调用点。
   */
  get _MASCOT() {
    return 'icons/mascot/mascot.png';
  }

  /**
   * 哪些状态下挂角标（v2.8.6）。
   * normal 不挂 —— 待命是常态，常态不需要提示。
   * 符号（✓ / ! / ?）写在 CSS 里，用 ::after 生成而不是塞文本节点：
   *   ① 按钮的 textContent 保持「完成」「重试」两个字，不被符号污染；
   *   ② 装饰性符号不进无障碍树，读屏不会念出「完成 对勾」。
   */
  get _BADGE_STATES() {
    return ['success', 'error', 'ask'];
  }

  /** 取扩展内资源的绝对地址；没有扩展运行时（单测 / 资源缺失）返回空串走线稿降级 */
  _mascotUrl() {
    const rel = this._MASCOT;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime &&
          typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(rel);
      }
    } catch (e) { /* 测试环境没有 runtime */ }
    return '';
  }

  constructor() {
    this.button = null;
    this.isLoading = false;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    // v2.5.60：按钮在构造函数里就插进页面，而 onClick 要等 initFieldMapper() 才接上，
    // 中间隔着 await（等 ModalManager 加载），实测有 1.2~1.4 秒「按钮在、点了没反应」。
    // isReady 就是这段窗口期的开关：没就绪就置灰 + disabled，让按钮别装作能用。
    this.isReady = false;

    // v2.5.92：拖动/点击手感重做，这几个字段是配套状态。
    // DRAG_THRESHOLD —— 按下后位移小于 4px 一律当「手抖」，不判拖动。
    //   原来零阈值：一抖就 isDragging=true，紧接着那次 click 被门禁吞掉，
    //   用户表现为「有时点一次就行、有时要点三四次」。
    this.DRAG_THRESHOLD = 4;
    this._pointerDown = false;      // 本次按下是否还在按住
    this._pointerId = null;
    this._dragMoved = false;        // 本次按下是否真的拖动过（click 消费一次后清零）
    this._startPoint = { x: 0, y: 0 };
    this._basePos = { left: 0, top: 0 };
    this._dragMetrics = null;       // 按下瞬间缓存的尺寸/视口，拖动过程中不再读布局
    this._pendingPos = null;        // rAF 待写入的目标位置
    this._dragRaf = 0;
    this._busyNoticeAt = 0;         // 「正在提取中」提示的节流时间戳
    this.userMoved = false;         // v2.5.97：用户亲手拖过 → 贴位逻辑（推荐流）不再抢位置

    this.init();
  }

  init() {
    this.createButton();
    this.attachEvents();
    this.loadSavedPosition();
  }

  createButton() {
    this.button = document.createElement('button');
    this.button.className = 'media-extractor-button';
    // v2.8.5：图标换成吉祥物头像，文字从「提取信息」缩成「提取」
    //   —— 头像本身承载了「这是什么」的识别成本，四个状态各有表情，见 _renderButton
    this._renderButton('normal', this.LABEL_IDLE);
    this.button.title = '扩展正在初始化，稍等一下再点';
    // v2.5.60：创建即置灰，等点击动作接上之后再放开
    this.button.disabled = true;
    this.button.classList.add('pending');

    document.body.appendChild(this.button);
  }

  attachEvents() {
    // v2.5.92：先 bind 再注册。原来反着写（先 addEventListener、末尾才 bind），
    // 靠「同一次同步流程里 bind 紧跟着执行」侥幸没出错，但一旦顺序被人改动，
    // 传进去的会是 undefined，监听直接不生效。
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onWindowBlur = this._onWindowBlur.bind(this);

    this.button.addEventListener('pointerdown', this._onPointerDown);

    // 点击门禁：只看「本次按下有没有真的拖动过」。
    // 用消费式标志替代原来的「延迟 100ms 复位 isDragging」——
    // 那个延迟会造出一个 100ms 盲区，盲区里的点击全被吞掉，正是「要点两三次」的直接原因。
    this.button.addEventListener('click', () => {
      if (this._dragMoved) {
        this._dragMoved = false;
        return;
      }
      if (this.isLoading) {
        this._notifyBusy();
        return;
      }
      if (typeof this.onClick === 'function') this.onClick();
    });
  }

  /**
   * 按下：只在这里读一次布局，之后整个拖动过程不再碰 offsetWidth/offsetTop。
   * v2.5.92：从 mouse 事件换成 pointer 事件 + 指针捕获，拖到窗口外松手也能收到 up。
   */
  _onPointerDown(e) {
    // 只响应左键（触摸/触控笔的 button 也是 0）
    if (typeof e.button === 'number' && e.button !== 0) return;

    this._pointerDown = true;
    this._dragMoved = false;
    this._pointerId = (typeof e.pointerId === 'number') ? e.pointerId : null;
    this._startPoint.x = e.clientX;
    this._startPoint.y = e.clientY;

    this._basePos.left = Number(this.button.offsetLeft) || 0;
    this._basePos.top = Number(this.button.offsetTop) || 0;
    this.dragOffset.x = e.clientX - this._basePos.left;
    this.dragOffset.y = e.clientY - this._basePos.top;

    // 尺寸与视口缓存一次：拖动中每帧读 offsetWidth 会强制同步布局（layout thrashing）
    this._dragMetrics = {
      w: Number(this.button.offsetWidth) || 0,
      h: Number(this.button.offsetHeight) || 0,
      vw: window.innerWidth,
      vh: window.innerHeight
    };

    // 指针捕获：鼠标移出窗口再松手，pointerup 仍会回到按钮。
    // 原来只有 document 级 mouseup，拖出窗口就永远收不到 → 监听残留、isDragging 卡住，
    // 之后鼠标一动按钮就跟着跑、点击长期失灵，必须刷新页面才恢复。
    try {
      if (this._pointerId !== null && typeof this.button.setPointerCapture === 'function') {
        this.button.setPointerCapture(this._pointerId);
      }
    } catch (err) { /* 不支持就算了，下面还有 blur 兜底 */ }

    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
    document.addEventListener('pointercancel', this._onPointerCancel);
    window.addEventListener('blur', this._onWindowBlur);
  }

  _onPointerMove(e) {
    if (!this._pointerDown) return;

    const dx = e.clientX - this._startPoint.x;
    const dy = e.clientY - this._startPoint.y;

    // 阈值门禁：没超过阈值 = 手抖，不进入拖动、不移动按钮、不吞点击
    if (!this.isDragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < this.DRAG_THRESHOLD) return;
      this.isDragging = true;
      this._dragMoved = true;
      this.button.classList.add('dragging');
    }

    const m = this._dragMetrics || {
      w: this.button.offsetWidth,
      h: this.button.offsetHeight,
      vw: window.innerWidth,
      vh: window.innerHeight
    };
    const maxX = Math.max(0, m.vw - m.w);
    const maxY = Math.max(0, m.vh - m.h);
    const newX = Math.max(0, Math.min(this._basePos.left + dx, maxX));
    const newY = Math.max(0, Math.min(this._basePos.top + dy, maxY));

    // 只记目标值，写入交给 rAF 合帧：一帧最多写一次，不再「每个 mousemove 都重排一次」
    this._pendingPos = { left: newX, top: newY };
    this._scheduleDragFrame();
  }

  /** 合帧写入：全程只改 transform（合成层，不重排），left/top 松手时才落一次 */
  _scheduleDragFrame() {
    if (this._dragRaf) return;
    const raf = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
      ? window.requestAnimationFrame.bind(window)
      : (cb) => setTimeout(cb, 16);
    this._dragRaf = raf(() => {
      this._dragRaf = 0;
      const pos = this._pendingPos;
      if (!pos || !this.button) return;
      const dx = pos.left - this._basePos.left;
      const dy = pos.top - this._basePos.top;
      this.button.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
    });
  }

  _onPointerUp() {
    this._finishDrag(true);
  }

  _onPointerCancel() {
    // 被系统打断（手势被页面接管 / 触摸被取消）：不保存位置，只收拾现场
    this._finishDrag(false);
  }

  _onWindowBlur() {
    // 窗口失焦（alt-tab、切标签）：pointerup 可能永远不来，必须在这里收尾
    this._finishDrag(true);
  }

  /**
   * 收尾：摘监听、把 transform 落成 left/top、保存位置。
   * isDragging 在这里立刻复位（不再有 100ms 盲区），紧随其后的 click 由 _dragMoved 拦住。
   */
  _finishDrag(save) {
    if (!this._pointerDown && !this.isDragging) {
      this._detachPointerEvents();
      return;
    }
    this._pointerDown = false;
    this._detachPointerEvents();

    if (this._dragRaf) {
      try {
        if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(this._dragRaf);
        else clearTimeout(this._dragRaf);
      } catch (e) { /* 忽略 */ }
      this._dragRaf = 0;
    }

    if (this.isDragging) {
      const pos = this._pendingPos || { left: this._basePos.left, top: this._basePos.top };
      this.button.style.transform = '';
      this.button.style.left = pos.left + 'px';
      this.button.style.top = pos.top + 'px';
      this.button.style.right = 'auto';
      this.button.style.bottom = 'auto';
      this.button.classList.remove('dragging');
      if (save) {
        this.savePosition(pos);
        // v2.5.97：用户**亲手拖过**按钮。贴位逻辑（TikTok 推荐流等）看到这个标志就不再抢位置，
        // 他要放哪儿就放哪儿，直到下一次整页刷新。轻点不算（只有真拖动才会走到这里）。
        this.userMoved = true;
      }
    }

    this._pendingPos = null;
    this._dragMetrics = null;
    this.isDragging = false;
  }

  _detachPointerEvents() {
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('pointercancel', this._onPointerCancel);
    window.removeEventListener('blur', this._onWindowBlur);
    try {
      if (this._pointerId !== null && this.button && typeof this.button.releasePointerCapture === 'function') {
        this.button.releasePointerCapture(this._pointerId);
      }
    } catch (err) { /* 已经释放过就忽略 */ }
    this._pointerId = null;
  }

  /** 提取中又点了一下：给个明确反馈，别再让用户以为按钮坏了 */
  _notifyBusy() {
    const now = Date.now();
    if (now - this._busyNoticeAt < 2000) return;
    this._busyNoticeAt = now;
    this.showMessage('正在提取中，请稍等一下…', 'info');
  }

  /**
   * 保存按钮位置（按域名）。
   * v2.5.92：可直接传入刚算好的位置，省掉一次 offsetLeft/offsetTop 读取（那是强制布局）。
   */
  savePosition(position) {
    const pos = position || {
      left: this.button.offsetLeft,
      top: this.button.offsetTop
    };
    
    // 使用localStorage保存位置（按域名保存）
    const key = `clipmate-button-position-${window.location.hostname}`;
    localStorage.setItem(key, JSON.stringify(pos));

    // v2.5.77 批 3：抖音弹窗把按钮自动贴在弹窗右上角。用户一旦手动拖过，
    // 由接线层收到这个回调后停止自动贴位，否则切下一条时按钮会被拽回原位。
    try {
      if (typeof this.onPositionSaved === 'function') this.onPositionSaved(pos);
    } catch (e) { /* 回调异常不许影响保存位置 */ }
  }

  loadSavedPosition() {
    const key = `clipmate-button-position-${window.location.hostname}`;
    const saved = localStorage.getItem(key);
    
    if (saved) {
      try {
        const position = JSON.parse(saved);
        
        // 检查保存的位置是否在可视区域内
        const maxX = window.innerWidth - this.button.offsetWidth;
        const maxY = window.innerHeight - this.button.offsetHeight;
        
        if (position.left >= 0 && position.left <= maxX && 
            position.top >= 0 && position.top <= maxY) {
          this.button.style.left = position.left + 'px';
          this.button.style.top = position.top + 'px';
          this.button.style.right = 'auto';
          this.button.style.bottom = 'auto';
        }
      } catch (e) {
        console.error('加载按钮位置失败:', e);
      }
    }
  }

  /**
   * 提取状态切换（v2.5.45 重写）
   *
   * 原实现只有一个布尔参数：setLoading(false) 无论成功还是失败都渲染绿色的「提取完成」，
   * 所以提取失败时按钮会亮起成功态，属于明确误导。
   * 现在拆成 setSuccess / setError 两条独立路径；setLoading(false) 保留为成功语义（向后兼容）。
   */
  /**
   * 提取状态切换（v2.5.45 重写）
   *
   * 原实现只有一个布尔参数：setLoading(false) 无论成功还是失败都渲染绿色的「提取完成」，
   * 所以提取失败时按钮会亮起成功态，属于明确误导。
   * 现在拆成 setSuccess / setError 两条独立路径；setLoading(false) 保留为成功语义（向后兼容）。
   *
   * 图标用 createElementNS 逐节点构建（不用 innerHTML 拼 SVG），
   * 原因是 web-ext 会对 innerHTML 报 "Unsafe assignment"，保持 lint 基线不上升。
   */
  setLoading(loading = true) {
    this.isLoading = !!loading;
    if (!this.button) return;

    if (loading) {
      this.button.classList.remove('success', 'error', 'pending');
      this.button.classList.add('loading');
      this._renderButton('normal', this.LABEL_BUSY);
      // v2.5.92：提取中不再 disabled。
      // disabled 的按钮在 Chrome 里连 click / mousedown 都不派发，用户点下去毫无反应，
      // 以为坏了就继续点，全被静默吞掉 —— 这也是「要点好几次」的一大来源。
      // 现在保持可点，重复点击由 click 门禁接住并弹一条「正在提取中」。
      this.button.disabled = !this.isReady;
      this.button.title = '正在提取，稍等一下';
    } else {
      this.setSuccess();
    }
  }

  setSuccess() {
    this.isLoading = false;
    if (!this.button) return;
    this.button.classList.remove('loading', 'error');
    this.button.classList.add('success');
    this._renderButton('success', this.LABEL_OK);
    this.button.title = '点击再次提取，拖动可移动按钮位置';
    this._restoreButtonSoon();
  }

  setError() {
    this.isLoading = false;
    if (!this.button) return;
    this.button.classList.remove('loading', 'success');
    this.button.classList.add('error');
    this._renderButton('error', this.LABEL_BAD);
    // 失败后允许立刻重试，不像成功态那样等 3 秒
    this.button.disabled = !this.isReady;
    this.button.title = '点击重试，拖动可移动按钮位置';
    this._restoreButtonSoon();
  }

  /** 3 秒后恢复成初始外观（成功/失败共用） */
  _restoreButtonSoon() {
    if (this._restoreTimer) clearTimeout(this._restoreTimer);
    this._restoreTimer = setTimeout(() => {
      this._restoreTimer = null;
      if (!this.button) return;
      this.button.classList.remove('success', 'error');
      this._renderButton('normal', this.LABEL_IDLE);
      // v2.5.60：还没就绪的按钮不能借这个定时器放开
      this.button.disabled = !this.isReady;
      this.button.title = this.isReady ? '点击提取页面媒体信息，拖动可移动按钮位置' : '扩展正在初始化，稍等一下再点';
    }, 3000);
  }

  /** 降级用线稿图标（只在拿不到扩展资源时出现） */
  get _ICON_DOC() {
    return [
      ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
      ['polyline', { points: '14,2 14,8 20,8' }],
      ['line', { x1: '16', y1: '13', x2: '8', y2: '13' }],
      ['line', { x1: '16', y1: '17', x2: '8', y2: '17' }],
      ['polyline', { points: '10,9 9,9 8,9' }]
    ];
  }

  /** 构建 16×16 线性图标 */
  _makeIcon(shapes) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    shapes.forEach(([tag, attrs]) => {
      const node = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
      svg.appendChild(node);
    });
    return svg;
  }

  /**
   * 重绘按钮内容：吉祥物头像 + 文字 + 状态角标（v2.8.6）
   *
   * 结构固定为 <span.clipmate-mascot-ring><span.clipmate-mascot></span></span>
   * + 文本节点 + [<span.clipmate-badge>符号</span>]，角标只有成功/失败/疑问时才有。
   * 头像在所有状态下都是同一张图，状态改由角标表达（理由见 _MASCOT 注释）。
   * 拿不到扩展资源时退回线稿文档图标，绝不让按钮变成空白方块。
   */
  _renderButton(state, label) {
    if (!this.button) return;
    this.button.textContent = '';

    const ring = document.createElement('span');
    ring.className = 'clipmate-mascot-ring';

    const face = document.createElement('span');
    face.className = 'clipmate-mascot';
    face.setAttribute('data-state', state);

    const url = this._mascotUrl();
    if (url) {
      face.style.backgroundImage = 'url("' + url + '")';
    } else {
      face.appendChild(this._makeIcon(this._ICON_DOC));
      face.classList.add('is-fallback');
    }

    ring.appendChild(face);
    this.button.appendChild(ring);
    this.button.appendChild(document.createTextNode(label));

    // 角标：纯装饰，不参与命中（CSS 里 pointer-events:none），点了还是按钮本身。
    // 符号由 .clipmate-badge[data-tone] 的 ::after 提供，DOM 里不放文字。
    if (this._BADGE_STATES.indexOf(state) !== -1) {
      const dot = document.createElement('span');
      dot.className = 'clipmate-badge';
      dot.setAttribute('data-tone', state);
      dot.setAttribute('aria-hidden', 'true');
      this.button.appendChild(dot);
    }
  }

  /** 显示/隐藏按钮（对应 popup 的「显示提取按钮」开关，v2.5.45 接线） */
  setVisible(visible) {
    if (!this.button) return;
    const show = visible !== false;
    this.isVisible = show;
    this.button.style.display = show ? '' : 'none';
  }

  showSuccess(message = '数据已复制到剪贴板') {
    this.showMessage(message, 'success');
  }

  /** @param {object} [options] { detail, copyText } 失败时带技术细节（v2.5.45 / B6） */
  showError(message = '提取失败，请重试', options) {
    this.showMessage(message, 'error', options);
  }

  /**
   * 显示提示（v2.5.44 起统一交给 ClipMateNotice 渲染）
   *
   * 旧实现往网页 body 追加一条 12px 白底细字，3 秒后删掉，基本看不见。
   * 现在走统一组件：浮窗在就显示在浮窗标题栏下方，浮窗不在（提取失败就是这种情况）
   * 就显示在页面顶部居中卡片，而且不会自动消失。
   */
  showMessage(message, type = 'success', options) {
    const notice = (typeof window !== 'undefined') ? window.ClipMateNotice : null;
    if (notice && typeof notice.show === 'function') {
      notice.show(message, type, options);
      return;
    }

    // 兜底：组件未加载时至少还能看到提示（同样不自动消失）
    console.warn('[ClipMate] 提示组件未加载，降级显示:', message);
    const fallbackType = (type === 'error') ? 'error' : (type === 'info' ? 'info' : 'success');
    const messageEl = document.createElement('div');
    messageEl.className = 'clipmate-notice clipmate-notice--page clipmate-notice--' + fallbackType;
    messageEl.textContent = message;
    messageEl.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 14px;background:#fff;border:1px solid #333;font-size:14px;';
    document.body.appendChild(messageEl);
  }

  setClickHandler(handler) {
    this.onClick = handler;
    this.isReady = true;
    // v2.5.60：接上动作的同时放开按钮，并摘掉置灰样式
    if (this.button) {
      this.button.classList.remove('pending');
      this.button.disabled = false;
      this.button.title = '点击提取页面媒体信息，拖动可移动按钮位置';
    }
  }

  hide() {
    if (this.button && this.button.parentNode) {
      this.button.parentNode.removeChild(this.button);
    }
  }

  show() {
    if (!this.button.parentNode) {
      document.body.appendChild(this.button);
    }
  }
}

// 导出按钮管理器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ButtonManager;
} else {
  window.ButtonManager = ButtonManager;
}