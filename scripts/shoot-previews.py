# -*- coding: utf-8 -*-
"""
截取「借壳预览页」的图，供交付图合成用。

为什么不用真扩展页：chrome-extension:// 无法被无头浏览器访问（跨扩展被硬拒），
所以 popup / 设置页 / 页内按钮都改成「把真 HTML + 真 CSS + 真 JS 搬到 http 页上」再截。
入口页：tests/_popup-preview.html、tests/_btn-preview.html、tests/_options-preview.html

为什么必须起 http 服务而不是 file://：Edge 无头下 file:// 页面里
<img src="x.svg"> 加载不出来（--allow-file-access-from-files 也无效），
fetch 也受限；http 下全都正常。

用法：
    python scripts/shoot-previews.py              # 全拍
    python scripts/shoot-previews.py btn opt      # 只拍名字里含这些的
"""

import os
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, '_shots')

EDGE_CANDIDATES = (
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\chrome.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
)

# name, 相对路径（含查询串）, 视口宽, 视口高
SHOOT = [
    ('btn_light',   'tests/_btn-preview.html',                 1180, 1200),
    ('btn_dark',    'tests/_btn-preview.html?dark=1',          1180, 1200),
    ('normal_light', 'tests/_popup-preview.html',               360, 780),
    ('normal_dark',  'tests/_popup-preview.html?theme=dark',    360, 780),
    ('empty_light',  'tests/_popup-preview.html?s=empty',       360, 780),
    ('empty_dark',   'tests/_popup-preview.html?s=empty&theme=dark', 360, 780),
    ('chrome_light', 'tests/_popup-preview.html?s=chrome',      360, 780),
    ('opt_general', 'tests/_options-preview.html#general',     1010, 800),
    ('opt_about',   'tests/_options-preview.html#about',       1010, 800),
    ('opt_empty',   'tests/_options-preview.html?q=zzzz#sites', 1010, 800),
    ('opt_dark',    'tests/_options-preview.html?theme=dark#general', 1010, 800),
    ('fw_light',    'tests/_fw-preview.html',                  1180, 1500),
]


def find_edge():
    for p in EDGE_CANDIDATES:
        if os.path.isfile(p):
            return p
    raise SystemExit('找不到 Edge / Chrome')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    wants = [a.lower() for a in sys.argv[1:]]
    shots = [s for s in SHOOT if not wants or any(w in s[0] for w in wants)]
    if not shots:
        raise SystemExit('没有匹配的截图任务')

    os.makedirs(SHOTS, exist_ok=True)
    edge = find_edge()
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = 'http://127.0.0.1:%d/' % port
    try:
        for _ in range(80):
            try:
                urllib.request.urlopen(base + 'tests/', timeout=0.4)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise SystemExit('http 服务没起来')

        for name, rel, w, h in shots:
            out = os.path.join(SHOTS, name + '.png')
            cmd = [
                edge,
                '--headless=new', '--disable-gpu', '--hide-scrollbars',
                '--force-device-scale-factor=2',
                '--window-size=%d,%d' % (w, h),
                '--virtual-time-budget=4000',
                '--user-data-dir=' + os.path.join(os.environ.get('TEMP', '.'), 'edge-shot-' + str(os.getpid())),
                '--screenshot=' + out,
                base + rel,
            ]
            r = subprocess.run(cmd, capture_output=True, timeout=120)
            ok = os.path.isfile(out) and os.path.getsize(out) > 2000
            print(('OK  ' if ok else 'FAIL'), name, rel, '' if ok else r.stderr.decode('utf-8', 'ignore')[:200])
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except Exception:
            srv.kill()


if __name__ == '__main__':
    main()
