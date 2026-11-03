// 提取按钮管理器
class ButtonManager {
  /** v2.8.5：按钮文字。只有四个地方用到，集中在这里，改文案不用翻全文。 */
  get LABEL_IDLE() { return '提取'; }
  get LABEL_BUSY() { return '提取中'; }
  get LABEL_OK() { return '完成'; }
  get LABEL_BAD() { return '重试'; }

  /**
   * 吉祥物形象 —— v2.9.2 起每态一张全身像（矢量 SVG）。
   *
   * 分工变了：以前是「一张脸 + 角标」，现在头像本身也带情绪，
   * 角标保留（它在绿底/红底上仍然是最快被眼角抓到的信号），
   * 两层信息互不重复：头像说「它此刻在干什么」，角标说「这一次成没成」。
   *
   * 为什么用全身像而不是头部特写（用户 2026-11-03 选的 B 方案）：
   *   头部特写在 48px 里最清楚，但只有五官、没有动作，四个状态差别太小；
   *   全身像有「举纸 / 抱电脑 / 抱绿勾 / 哭」四个动作，一眼就知道在干嘛。
   *   代价是人在 48px 里偏小 —— 已知并接受。
   *
   * 素材是用户 2026-11-03 给的矢量大合集拆出来的，每个文件自带 6 个渐变定义，
   * 反复缩放不会糊；每个文件 4~15KB。
   *
   * 页面里的元素用 background-image 引用，不是 <img>：
   * 站点对 img 的全局规则（max-width / object-fit / border-radius / display）
   * 会把这个头像改烂，background 只是背景图，碰不到。
   *
   * ⚠️ 新增状态时记得同时改 content-styles.css 里的头像尺寸：
   *    四个形态宽高比不同（0.985~1.099），尺寸按「高度」控制才不会有的溢出过多。
   */
  get _MASCOT_BY_STATE() {
    return {
      normal: 'icons/mascot/hero-doc.svg',    // 举着一张纸：等着提取
      success: 'icons/mascot/hero-done.svg',  // 抱着绿勾：提取完成
      error: 'icons/mascot/hero-cry.svg',     // 哭：这一步没成
      busy: 'icons/mascot/face-busy.svg',     // >_< ：读取提示条用（那个尺寸只能用头部）
    };
  }

  /** 兜底形态：状态取值意外时不让头像空掉 */
  get _MASCOT_FALLBACK() {
    return 'icons/mascot/hero-doc.svg';
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
  _mascotUrl(state) {
    const map = this._MASCOT_BY_STATE;
    const rel = (map && map[state]) || this._MASCOT_FALLBACK;
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
    this._readingTimer = null;      // v2.9.2：慢提取提示条的延迟定时器
    this._readingEl = null;         // v2.9.2：提示条节点（不存在时为 null）
    this._detachButtonTheme = null; // v2.9.3：取消按钮跟随站点明暗
    this._detachReadingTheme = null; // v2.9.3：取消提示条跟随站点明暗

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
    //   —— 头像本身承载了「这是什么」的识别成本；v2.9.2 起四个状态各有形态，
    //      见 _MASCOT_BY_STATE（举纸 / 抱绿勾 / 哭）。
    this._renderButton('normal', this.LABEL_IDLE);
    this.button.title = '扩展正在初始化，稍等一下再点';
    // v2.5.60：创建即置灰，等点击动作接上之后再放开
    this.button.disabled = true;
    this.button.classList.add('pending');

    document.body.appendChild(this.button);
    // v2.9.3：深色站点上按钮也换暖黑（否则一块白板贴在黑页面上，很扎眼）
    this._detachButtonTheme = this._syncSiteTheme(this.button);
  }

  /**
   * 让元素跟随站点明暗。
   * 单独抽出来是因为调用点散布在按钮、慢提取提示条两处，
   * 而 SiteTheme 在单元测试里常常没加载 —— 守卫写一处，别的地方不用重复判空。
   * @returns {(() => void)|null} 取消跟随；环境不支持时返回 null
   */
  _syncSiteTheme(el) {
    if (!el || typeof SiteTheme === 'undefined' || !SiteTheme.shared) return null;
    try {
      return SiteTheme.shared.attach(el);
    } catch (e) {
      return null;
    }
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
    // v2.9.7 真机修复：拖拽期间 basePos 会被联动钳制（applyExternalPosition）改写，
    // 指针目标必须从「按下瞬间冻结的起点」算，否则已吸收过的位移每帧复利叠加，
    // 实测位移会被放大好几倍、一路顶死在屏幕边上。收尾时清掉。
    this._dragOrigin = { left: this._basePos.left, top: this._basePos.top };
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
    // 目标一律从冻结起点算（_dragOrigin），basePos 中途被联动改写也不影响指针语义
    const o = this._dragOrigin || this._basePos;
    const newX = Math.max(0, Math.min(o.left + dx, maxX));
    const newY = Math.max(0, Math.min(o.top + dy, maxY));

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
      // v2.9.7：浮窗联动 —— 拖按钮时把「本次拖动的绝对目标位置」报给监听者
      //（modal-window），浮窗跟着走同样的距离。
      if (typeof this.onDragMove === 'function') this.onDragMove(pos.left, pos.top);
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
    this._dragOrigin = null;
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

  /**
   * v2.9.7：浮窗联动 —— 拖浮窗（或窗口被推回视口）时由 modal-window 调这里，
   * 把按钮搬到绝对位置。与用户手拖等效：更新 basePos、停自动贴位，但不落盘
   * （拖动过程中每帧都写 localStorage 太浪费），落盘走 commitExternalPosition。
   */
  applyExternalPosition(left, top) {
    if (!this.button) return;
    const l = Math.round(left);
    const t = Math.round(top);
    this.button.style.transform = '';
    this.button.style.left = l + 'px';
    this.button.style.top = t + 'px';
    this.button.style.right = 'auto';
    this.button.style.bottom = 'auto';
    this._basePos = { left: l, top: t };
    this._pendingPos = { left: l, top: t };
    this.userMoved = true;
  }

  /** v2.9.7：联动拖动收尾，把按钮最终位置记下来（一次，不逐帧） */
  commitExternalPosition(left, top) {
    if (!this.button) return;
    const l = Math.round(left);
    const t = Math.round(top);
    this._basePos = { left: l, top: t };
    this.userMoved = true;
    this.savePosition({ left: l, top: t });
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
  setLoading(loading = true, options = {}) {
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
      // v2.9.2：慢提取时给个陪伴。自动提取不弹 —— 用户没点任何东西，
      // 页面一打开就冒出个条子，看着像报错。
      if (options.quiet) this._stopReadingHint();
      else this._armReadingHint();
    } else {
      this._stopReadingHint();
      this.setSuccess();
    }
  }

  /* ---------- v2.9.2：慢提取的陪伴提示 ----------
     提取通常 100~300ms，为它做个遮罩只会闪一下；真的会卡住的是 TMDB 拉完整演职员表、
     豆瓣影人翻页这类。所以延迟到 700ms 才出现，而且只占右上角一小条 ——
     不盖页面、不吃点击（pointer-events:none），用户该怎么滚还怎么滚。

     素材用「>_<」的脸，不用抱电脑的全身像：这个尺寸下抱着的电脑只剩一个灰点，
     表情反而还读得出来 —— 30px 是全身像的辨识下限以下。 */
  static get READING_WAIT() { return 700; }

  _armReadingHint() {
    this._stopReadingHint();
    this._readingTimer = setTimeout(() => {
      this._readingTimer = null;
      this._mountReadingHint();
    }, ButtonManager.READING_WAIT);
  }

  _stopReadingHint() {
    if (this._readingTimer) {
      clearTimeout(this._readingTimer);
      this._readingTimer = null;
    }
    if (this._detachReadingTheme) {
      this._detachReadingTheme();
      this._detachReadingTheme = null;
    }
    if (this._readingEl && this._readingEl.parentNode) {
      this._readingEl.parentNode.removeChild(this._readingEl);
    }
    this._readingEl = null;
  }

  _mountReadingHint() {
    if (this._readingEl || !document.body) return;

    const box = document.createElement('div');
    box.className = 'clipmate-reading-hint';
    // role=status + polite：读屏会等当前这句念完再报，不打断
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');

    const art = document.createElement('span');
    art.className = 'clipmate-reading-art';
    const url = this._mascotUrl('busy');
    if (url) art.style.backgroundImage = 'url("' + url + '")';
    art.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'clipmate-reading-text';
    text.textContent = '正在读取页面…';

    box.appendChild(art);
    box.appendChild(text);
    document.body.appendChild(box);
    this._detachReadingTheme = this._syncSiteTheme(box);
    this._readingEl = box;

    // 下一帧再挂 class，否则同一个 tick 里插入 + 加类，transition 不会触发
    requestAnimationFrame(() => {
      if (this._readingEl === box) box.classList.add('is-on');
    });
  }

  setSuccess() {
    this.isLoading = false;
    this._stopReadingHint();
    if (!this.button) return;
    this.button.classList.remove('loading', 'error');
    this.button.classList.add('success');
    this._renderButton('success', this.LABEL_OK);
    this.button.title = '点击再次提取，拖动可移动按钮位置';
    this._restoreButtonSoon();
  }

  setError() {
    this.isLoading = false;
    this._stopReadingHint();
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
   * 重绘按钮内容：吉祥物头像 + 文字 + 状态角标
   *
   * 结构固定为 <span.clipmate-mascot-ring><span.clipmate-mascot></span></span>
   * + 文本节点 + [<span.clipmate-badge>符号</span>]，角标只有成功/失败/疑问时才有。
   * 头像按 state 换成对应形态（举纸 / 抱绿勾 / 哭），见 _MASCOT_BY_STATE。
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

    const url = this._mascotUrl(state);
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