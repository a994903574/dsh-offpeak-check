(function () {
  var BAR = "[data-windows-menu]"
  var ID_BTN = "dsh-offpeak-btn"
  var ID_PANEL = "dsh-offpeak-panel"
  // 样式照抄外壳菜单栏原生 button 规则
  var BTN_CSS = "height:28px;padding:0 10px;border:0;border-radius:6px;background:transparent;" +
    "color:var(--dsw-alias-label-secondary,inherit);font-family:inherit;font-size:13px;" +
    "font-weight:400;line-height:28px;cursor:default;-webkit-app-region:no-drag"
  var DATA = null

  function menuBar() {
    try {
      var hosts = document.querySelectorAll(BAR)
      for (var i = 0; i < hosts.length; i++) {
        var shadow = hosts[i].shadowRoot
        if (!shadow) continue
        var bar = shadow.querySelector("[role=menubar]")
        if (bar) return bar
      }
    } catch (e) { }
    return null
  }

  function hoverStyle(bar) {
    try {
      var root = bar.getRootNode()
      if (!root || typeof root.querySelector !== "function") return
      if (root.querySelector("#dsh-offpeak-hover")) return
      var st = document.createElement("style")
      st.id = "dsh-offpeak-hover"
      st.textContent = "#" + ID_BTN + ":hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18)) !important;color:var(--dsw-alias-label-primary,inherit) !important}"
      ;(root.nodeType === 11 ? root : (document.head || document.documentElement)).appendChild(st)
    } catch (e) { }
  }

  function pad(n) { return (n < 10 ? "0" : "") + n }
  function minutes(hhmm) { var p = String(hhmm).split(":"); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0) }
  function hhmm(m) { if (m === 1440) return "24:00"; m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ":" + pad(m % 60) }

  // 峰期 -> 低峰（同一天内的补集），入参是 [[from,to],...] 分钟数
  function invert(pts) {
    var list = (pts || []).slice().sort(function (a, b) { return a[0] - b[0] })
    var out = [], cur = 0
    for (var j = 0; j < list.length; j++) {
      if (list[j][0] > cur) out.push([cur, list[j][0]])
      cur = Math.max(cur, list[j][1])
    }
    if (cur < 1440) out.push([cur, 1440])
    return out
  }

  function rangeText(list) {
    if (!list.length) return "—"
    return list.map(function (r) { return hhmm(r[0]) + "–" + hhmm(r[1]) }).join("、")
  }

  function nowState(peak) {
    var now = new Date()
    var dow = now.getDay()
    var cur = now.getHours() * 60 + now.getMinutes()
    if (dow === 0 || dow === 6) {
      var toMon = (8 - dow) * 1440 - cur // 周日(0)→2天? 周六(6)→1天
      if (dow === 0) toMon = 1440 - cur
      return { peak: false, weekend: true, nextAt: null, deltaMin: toMon }
    }
    var inPeak = null
    for (var i = 0; i < peak.length; i++) {
      var f = minutes(peak[i].from), t = minutes(peak[i].to)
      if (cur >= f && cur < t) { inPeak = [f, t]; break }
    }
    if (inPeak) return { peak: true, nextAt: inPeak[1], deltaMin: inPeak[1] - cur }
    var next = null
    for (var j = 0; j < peak.length; j++) {
      var s = minutes(peak[j].from)
      if (s > cur) { next = s; break }
    }
    return { peak: false, nextAt: next, deltaMin: next === null ? (1440 - cur) : next - cur }
  }

  function human(min) {
    var h = Math.floor(min / 60), m = min % 60
    if (h && m) return h + " 小时 " + m + " 分"
    if (h) return h + " 小时"
    return m + " 分钟"
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] }) }

  function render() {
    var panel = document.getElementById(ID_PANEL)
    if (!panel || !DATA) return
    var peak = (DATA.peak || []).map(function (r) { return [minutes(r.from), minutes(r.to)] })
    var st = nowState(DATA.peak || [])
    var status = DATA.status || {}
    var checked = status.at ? new Date(status.at) : null
    var WD = ["日", "一", "二", "三", "四", "五", "六"]
    var nowD = new Date()
    var dateTag = (nowD.getMonth() + 1) + "月" + nowD.getDate() + "日 周" + WD[nowD.getDay()]
    var stateLine = st.weekend
      ? '<b style="color:#3ba55d">全天低峰期 · 五折</b>'
      : (st.peak ? '<b style="color:#e5484d">高峰期 · 原价</b>' : '<b style="color:#3ba55d">低峰期 · 五折</b>')
    var nextLine = ""
    if (st.weekend) nextLine = "下一段原价：周一 " + hhmm(peak.length ? peak[0][0] : 540) + "（" + human(st.deltaMin) + "后）"
    else if (st.peak) nextLine = "五折结束：" + hhmm(st.nextAt) + "（" + human(st.deltaMin) + "后）"
    else if (st.nextAt !== null) nextLine = "下一段原价：" + hhmm(st.nextAt) + "（" + human(st.deltaMin) + "后）"
    else nextLine = "今天已无原价时段"
    var isWeekend = st.weekend
    var peakLine = isWeekend ? "今日无（周末全天低峰期）" : (peak.length ? rangeText(peak) : "今日无")
    var lowLine = isWeekend ? "全天" : rangeText(invert(peak))
    var checkLine = checked
      ? "上次核对：" + checked.toLocaleString("zh-CN", { hour12: false }) + " · " + ({ match: "一致", changed: "发现变化（待确认）", stale: "抓取失败" }[status.result] || status.result)
      : "尚未核对"
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px">DeepSeek 峰期价格</div>' +
      '<div style="margin-bottom:8px"><span style="opacity:.6">' + dateTag + ' · </span>' + stateLine + '</div>' +
      '<div style="opacity:.85;line-height:1.7">' +
      '今日高峰期（原价）：' + peakLine + '<br>' +
      '今日低峰期（五折）：' + lowLine + '<br>' +
      nextLine + '</div>' +
      '<div style="margin-top:8px;opacity:.55;font-size:12px">' + checkLine + '</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px">' +
      '<button id="dsh-offpeak-recheck" style="height:26px;padding:0 10px;border-radius:6px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:12px;cursor:pointer">立即核对</button>' +
      '</div>'
    var btn = document.getElementById("dsh-offpeak-recheck")
    if (btn) btn.onclick = function () {
      btn.disabled = true; btn.textContent = "核对中…"
      fetch("/dsh-offpeak-check/check", { method: "POST" })
        .then(function (r) { return r.json() })
        .then(function () { return fetch("/dsh-offpeak-check/data").then(function (r) { return r.json() }) })
        .then(function (j) { DATA = j; render() })
        .catch(function () { btn.disabled = false; btn.textContent = "核对失败，重试" })
    }
  }

  function openPanel(anchor) {
    var old = document.getElementById(ID_PANEL)
    if (old) { old.parentNode.removeChild(old); return }
    var panel = document.createElement("div")
    panel.id = ID_PANEL
    panel.style.cssText = "position:fixed;top:44px;left:16px;z-index:2147483000;min-width:260px;" +
      "padding:12px 14px;border-radius:10px;font-family:var(--dsw-font-family,inherit);font-size:13px;" +
      "background:var(--dsw-alias-bg-elevated,#202124);color:var(--dsw-alias-label-primary,#e8eaed);" +
      "border:1px solid rgba(127,127,127,.28);box-shadow:0 8px 28px rgba(0,0,0,.45)"
    panel.innerHTML = '<div style="opacity:.6">读取中…</div>'
    document.body.appendChild(panel)
    if (DATA) render()
    fetch("/dsh-offpeak-check/data").then(function (r) { return r.json() })
      .then(function (j) { DATA = j; render() })
      .catch(function () { panel.innerHTML = '<div style="color:#e06c75">读不到配置（插件后端未就绪）</div>' })
    setTimeout(function () {
      document.addEventListener("mousedown", closeOnOutside, true)
      document.addEventListener("keydown", closeOnEsc, true)
    }, 0)
  }

  function closeOnOutside(e) {
    var panel = document.getElementById(ID_PANEL)
    if (!panel) return
    if (panel.contains(e.target)) return
    var btn = document.getElementById(ID_BTN)
    if (btn && e.target === btn) return
    var host = document.querySelector(BAR)
    if (host && host.shadowRoot && host.shadowRoot.contains(e.target)) return
    closePanel()
  }

  function closeOnEsc(e) { if (e.key === "Escape") closePanel() }

  function closePanel() {
    var panel = document.getElementById(ID_PANEL)
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
    document.removeEventListener("mousedown", closeOnOutside, true)
    document.removeEventListener("keydown", closeOnEsc, true)
  }

  function mount() {
    var bar = menuBar()
    if (!bar) return false
    if (bar.querySelector("#" + ID_BTN)) return true
    var btn = document.createElement("button")
    btn.id = ID_BTN
    btn.type = "button"
    btn.textContent = "价格"
    btn.title = "DeepSeek 峰期价格时段"
    btn.style.cssText = BTN_CSS
    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); openPanel(btn) })
    // 插到最左（左上角抬头栏的第一个位置）
    bar.insertBefore(btn, bar.firstChild)
    hoverStyle(bar)
    return true
  }

  var tries = 0
  var timer = setInterval(function () {
    tries++
    if (mount() || tries > 120) clearInterval(timer)
  }, 250)
})()
