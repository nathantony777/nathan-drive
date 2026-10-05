// app.js —— 「广州→太原」自驾离线网页 app 的界面：三个页（现在 / 行程 / 规矩）+ 打卡弹层 + 离线
//
// ★ 数据只从 window.PLAN（plan.js）读；打卡以后怎么重算全交给 window.Calc（calc.js：纯函数，有 node 自测）。
//   这里不许写死任何站名、时间、电量、具体数字 —— 页面上的数全从计划和打卡算出来；站数也不固定。
// ★ plan.js 缺哪个字段，那一块就不显示：不报错，也不拿别的数冒充。
// ★ 打卡存 localStorage，读写都包 try/catch；存不了照样显示计划，顶上说一句「打卡只在这次打开时有效」。
// ★ 导航用 <a href> 直接跳：iPhone 只认手势里同步发出的跳转，别 await 之后再 window.open。
// ★ 电量框要在点按钮的那一下同步 focus()，iPhone 才弹键盘（放进 setTimeout / await 之后就不弹了）。
(function () {
  'use strict';

  const P = window.PLAN, C = window.Calc;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const str = v => (typeof v === 'string' ? v.trim() : num(v) != null ? String(v) : '');
  const arr = v => (Array.isArray(v) ? v : []);
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const r1 = x => Math.round(x * 10) / 10;
  const MIN = 60 * 1000;

  // ---------- 计划或算账模块没读到：明确说哪儿坏了，不白屏 ----------
  function fatal(title, detail) {
    const tb = document.querySelector('.tabbar');
    if (tb) tb.classList.add('hide');
    $('app').innerHTML = '<section class="fatal"><h1>' + esc(title) + '</h1><p>' + esc(detail) + '</p>'
      + '<button type="button" class="btn primary block" onclick="location.reload()">刷新再试</button></section>';
  }
  if (!C || typeof C.compute !== 'function') { fatal('计算模块没读到', 'calc.js 没加载成功。联网刷新一下；还不行就截图告诉 Claude。'); return; }
  if (!obj(P) || !arr(P.stops).length) { fatal('计划数据没读到', 'plan.js 没加载成功，或者里面一个站都没有。联网刷新一下；还不行就截图告诉 Claude。'); return; }

  const exitAt = C.ms(P.exitNotBefore);
  const view = $('view');

  // ---------- 图标（线条画，跟着文字颜色走） ----------
  const ICONS = {
    now: '<path d="M12 2.5 20 21l-8-4.2L4 21z"/>',
    trip: '<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><path d="M6 7.2v9.6M11 5h9M11 12h9M11 19h9"/>',
    rules: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    cup: '<path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9.5h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5v3M12 2.5v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    exit: '<path d="M10 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5M15 16l4-4-4-4M19 12H9"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    nav: '<path d="M3 11 21 3l-8 18-2-8z"/>',
    go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  };
  const icon = name => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

  // 站的类型 → 徽章上的字和图标（「等 0 点」的「0 点」从 exitNotBefore 来，不写死）
  function typeInfo(type) {
    switch (type) {
      case 'start': return { label: '出发', icon: 'flag' };
      case 'charge': return { label: '充电', icon: 'bolt' };
      case 'sleep': return { label: '睡觉', icon: 'moon' };
      case 'rest': return { label: '休息', icon: 'cup' };
      case 'wait': return { label: exitAt != null ? '等 ' + C.fmtClockWord(exitAt) : '等待', icon: 'clock' };
      case 'exit': return { label: '出收费站', icon: 'exit' };
      case 'dest': return { label: '目的地', icon: 'pin' };
      default: return { label: '停靠', icon: 'pin' };
    }
  }
  const badge = (type, hot) => { const ti = typeInfo(type); return '<span class="badge' + (hot ? ' hot' : '') + '">' + icon(ti.icon) + esc(ti.label) + '</span>'; };

  // ---------- 时间怎么写 ----------
  // 今天的只写时刻；不是今天的带上日期（「9/30 23:10」）
  const when = (x, t) => (num(x) == null ? '' : C.dayKey(x) === C.dayKey(t) ? C.fmtHM(x) : C.fmtMD(x) + ' ' + C.fmtHM(x));
  const durLeft = ms => (ms < MIN ? '不到 1 分钟' : C.fmtDur(ms));
  // 大数字下面那行小字：不是今天就写日期；比计划晚 / 早多少，原计划几点
  function shiftSub(a, p, t) {
    const bits = [];
    if (num(a) != null && C.dayKey(a) !== C.dayKey(t)) bits.push(esc(C.fmtMD(a) + ' ' + C.fmtWeek(a)));
    if (num(a) != null && num(p) != null) {
      const d = a - p;
      if (Math.abs(d) < MIN) bits.push('准点');
      else bits.push('<span class="' + (d > 0 ? 'late' : 'early') + '">' + esc(C.fmtShift(d)) + '</span>', '计划 ' + esc(C.fmtHM(p)));
    }
    return bits.join(' · ');
  }

  // ---------- 存打卡（存不了只放内存，照样能用） ----------
  const KEY_CK = 'zijia.checkins.v1', KEY_CL = 'zijia.checklist.v1';
  const store = {
    ok: true, broken: [],
    get(key) {
      let raw;
      try { raw = window.localStorage.getItem(key); } catch (e) { this.ok = false; return {}; }
      if (raw == null || raw === '') return {};
      try { const v = JSON.parse(raw); if (obj(v)) return v; } catch (e) { /* 格式坏了：落到下面，出声 */ }
      this.broken.push(key);
      return {};
    },
    set(key, val) {
      try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { this.ok = false; return false; }
    },
  };
  const state = { tab: 'now', ck: C.cleanCheckins(store.get(KEY_CK)), cl: store.get(KEY_CL), open: {} };

  // ---------- 零件 ----------
  const pageHead = (title, sub) => (title || sub
    ? '<header class="pagehead">' + (title ? '<h1>' + esc(title) + '</h1>' : '') + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</header>' : '');
  const navName = (nav, fallback) => str(obj(nav) && nav.name) || str(fallback);
  function navBtn(nav, cls) {
    const url = C.amapUrl(obj(nav));
    return url ? '<a class="btn' + (cls ? ' ' + cls : '') + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('nav') + '导航</a>' : '';
  }
  const copyBtn = (text, cls) => (text
    ? '<button type="button" class="btn ghost' + (cls ? ' ' + cls : '') + '" data-act="copy" data-text="' + esc(text) + '">' + icon('copy') + '复制名称</button>' : '');
  const KIND_LABEL = { arrive: '我到了', leave: '出发', pass: '已出站' };
  const firstKind = row => (row.mode === 'leave' ? 'leave' : row.mode === 'pass' ? 'pass' : 'arrive');
  const checkBtn = (row, kind, cls, label) => '<button type="button" class="btn' + (cls ? ' ' + cls : '') + '" data-act="check" data-idx="' + row.idx
    + '" data-kind="' + kind + '">' + icon(kind === 'leave' ? 'go' : 'check') + esc(label || KIND_LABEL[kind]) + '</button>';
  const socTxt = v => (num(v) != null ? ' · ' + v + '%' : '');
  // 已经打过的卡：一颗一颗小按钮，点开能改、能删
  function recordChips(row) {
    const r = row.rec, out = [];
    if (!r) return '';
    const chip = (kind, text) => '<button type="button" class="chip" data-act="edit" data-idx="' + row.idx + '" data-kind="' + kind + '">'
      + esc(text) + ' <span class="edit">修改</span></button>';
    if (row.mode === 'pass') { if (r.arriveAt != null) out.push(chip('pass', '出站 ' + C.fmtHM(r.arriveAt) + socTxt(r.arriveSoc))); }
    else {
      if (r.arriveAt != null && row.mode !== 'leave') out.push(chip('arrive', '到 ' + C.fmtHM(r.arriveAt) + socTxt(r.arriveSoc)));
      if (r.leaveAt != null && row.mode !== 'arrive') out.push(chip('leave', '走 ' + C.fmtHM(r.leaveAt) + socTxt(r.leaveSoc)));
    }
    return out.join('');
  }
  // 大数字格子：宽的独占一行；剩下的凑不成双，最后一个也拉宽
  function statsHtml(list) {
    const xs = list.filter(x => x && x.v != null && x.v !== '');
    if (!xs.length) return '';
    const normal = xs.filter(x => !x.wide), lastOdd = normal.length % 2 ? normal[normal.length - 1] : null;
    return '<div class="stats">' + xs.map(x => '<div class="stat' + (x.cls ? ' ' + x.cls : '') + (x.wide || x === lastOdd ? ' wide' : '') + '">'
      + '<div class="k">' + esc(x.k) + '</div><div class="v num">' + esc(x.v) + (x.unit ? '<small>' + esc(x.unit) + '</small>' : '') + '</div>'
      + (x.sub ? '<div class="s">' + x.sub + '</div>' : '') + '</div>').join('') + '</div>';
  }
  const todoList = s => arr(s.todo).map(str).filter(Boolean);

  // 充电站品牌写「服务区」= 服务区自带的桩（国网等），不是理想 / 小鹏 / 蔚来 —— 是替他做的取舍（plan.js 的约定值，不是站名）。
  // 这种站界面上要长得不一样：黄色虚线框 + 醒目写出为什么（noBrandReason），不能混在两家的站里一眼看不出来。
  const SA = '服务区';
  const saOpts = s => arr(obj(s.charger) && s.charger.options).filter(o => obj(o) && str(o.brand) === SA);
  const usesSA = s => saOpts(s).length > 0 || !!str(s.noBrandReason);
  // 平时用的那几家（从整份计划里收：谁出现过就是谁），用来说「不是 X/Y」
  const usualBrands = (() => {
    const out = [];
    arr(P.stops).forEach(s => arr(obj(s) && obj(s.charger) && s.charger.options).forEach(o => {
      const b = str(obj(o) && o.brand);
      if (b && b !== SA && out.indexOf(b) < 0) out.push(b);
    }));
    return out;
  })();
  function saNotice(s) {
    if (!usesSA(s)) return '';
    const why = str(s.noBrandReason);
    return '<div class="notice warn sa-note"><b>这站用服务区自带的桩</b>' + (usualBrands.length ? '，不是' + esc(usualBrands.join('/')) : '')
      + (why ? '。' + esc(why) : '') + '</div>';
  }
  const saTag = s => (usesSA(s) ? '<span class="tag sa">服务区桩</span>' : '');

  // 充电站：两家都有就提醒到站前比价；未核实的标出来；服务区自带的桩单独一种样子
  function chargerHtml(s) {
    const ch = obj(s.charger), opts = arr(ch && ch.options).filter(obj);
    if (!opts.length) return '';
    const brands = [];
    opts.forEach(o => { const b = str(o.brand); if (b && b !== SA && brands.indexOf(b) < 0) brands.push(b); });
    const pick = str(ch.pick), cn = brands.length === 2 ? '两' : String(brands.length);
    let head = '';
    if (brands.length >= 2) head = esc(brands.join('/')) + ' ' + cn + '家都有，到站前在' + cn + '个 app 里比价';
    else if (brands.length === 1) head = '用' + esc(brands[0]);
    else if (saOpts(s).length) head = '用服务区自带的桩';
    if (pick && brands.length >= 2) head += '<span class="muted"> · 计划用' + esc(pick) + '</span>';
    return (head ? '<p class="pick-line">' + head + '</p>' : '') + opts.map(o => {
      const b = str(o.brand), sa = b === SA, bits = [];
      if (str(o.side)) bits.push('方向 ' + str(o.side));
      if (str(o.piles)) bits.push(str(o.piles) + ' 个桩');
      if (str(o.power)) bits.push('功率 ' + str(o.power));
      if (str(o.price)) bits.push('价格 ' + str(o.price));
      return '<div class="opt' + (sa ? ' sa' : '') + '">' + (b ? '<span class="brand' + (sa ? ' sa' : pick && b === pick ? ' pick' : '') + '">' + esc(sa ? '服务区桩' : b) + '</span>' : '')
        + '<div class="opt-main"><div class="opt-name">' + esc(str(o.name) || b) + (o.verified === false ? '<span class="tag warn">未核实</span>' : '') + '</div>'
        + (bits.length ? '<div class="opt-detail">' + esc(bits.join(' · ')) + '</div>' : '')
        + (str(o.note) ? '<div class="opt-note">' + esc(o.note) + '</div>' : '') + '</div></div>';
    }).join('');
  }

  // 按「从这里走时的电量」推：开到下一个充电站剩多少、要是在那儿先睡一觉睡醒剩多少（needs 的字段说明在 calc.js）
  const EPS = 1e-9;
  const arriveLeft = (need, basis) => (basis == null ? null : Math.floor(basis - need.usePct - (need.sleepPct - need.sleepEnd) + EPS));
  const sleepLeft = (need, basis) => (basis == null || !need.sleepEnd ? null : Math.floor(basis - need.usePct - need.sleepPct + EPS));
  // 「开到 X 要用约 U%，睡觉约耗 S%，再留 R%」
  const needWhy = need => '开到' + esc(need.toName) + '要用约 ' + Math.ceil(need.usePct - EPS) + '%'
    + (need.sleepPct > 0 ? '，睡觉约耗 ' + r1(need.sleepPct) + '%' : '') + '，再留 ' + need.reserve + '%';

  // 「至少充到 X%」那一组：计划充到的够就显示计划值；按实测耗电不够了就换成至少值并标红
  function chargeStats(R, row, need) {
    const target = num(row.stop.chargeTo);
    if (!need) return target != null ? [{ k: '要充到', v: target, unit: '%', cls: 'hot' }] : [];
    const short = target != null && need.minPct > target;
    const value = target == null ? need.minPct : Math.max(target, need.minPct);
    const y = arriveLeft(need, value), z = sleepLeft(need, value), worst = z != null ? z : y;
    return [{
      k: short || target == null ? '至少充到' : '要充到', v: value, unit: '%', cls: short || need.capped ? 'danger' : 'hot',
      sub: need.capped ? '<span class="late">充满也不够留 ' + need.reserve + '%：中途得多充一次</span>'
        : short ? '<span class="late">计划 ' + target + '% 不够</span>（按实测耗电）'
        : target != null ? '至少 ' + need.minPct + '%' : '',
    }, {
      k: need.toIdx === R.n - 1 ? '到终点剩约' : '到下个充电点剩约', v: y, unit: '%', cls: worst != null && worst < need.reserve ? 'danger' : '',
      sub: esc(need.toName) + (num(need.km) != null ? ' · ' + r1(need.km) + ' km' : '') + (z != null ? '<br>在那儿睡一觉约剩 ' + z + '%' : ''),
    }];
  }

  // ---------- 页：现在 ----------
  function stripHtml(R) {
    const cd = R.countdown;
    if (!cd) return '';
    const word = C.fmtClockWord(cd.at);
    if (cd.passed) return '<section class="strip ok"><div class="strip-big">已过 ' + esc(word) + '，可以出站</div></section>';
    return '<section class="strip"><div class="strip-k">离 ' + esc(C.fmtMD(cd.at) + ' ' + word) + ' 可以出收费站，还有</div>'
      + '<div class="strip-big num">' + esc(durLeft(cd.left)) + '</div></section>';
  }

  // 按现在的进度推算，出收费站会早于 0 点（等 0 点的站已经过了、或者计划里没有它）
  function exitWarnHtml(R, t) {
    if (!R.exitEarly || R.exitIdx < 0) return '';
    const xr = R.rows[R.exitIdx];
    if (xr.status === 'done' || xr.status === 'skipped') return '';
    return '<div class="notice bad"><b>按现在的进度，' + esc(when(xr.arrive, t)) + ' 就会到' + esc(str(xr.stop.name) || '收费站') + '，早于 '
      + esc(C.fmtClockWord(R.exitAt)) + '。</b>路上找个服务区，等到 ' + esc(C.fmtHM(R.exitAt)) + ' 以后再出站。</div>';
  }

  function heroHtml(R, t) {
    if (R.done) return doneHtml(R, t);
    const row = R.rows[R.cur], s = row.stop, ti = typeInfo(s.type);
    const here = R.atStop, prep = !here && row.mode === 'leave';
    const need = R.needs[row.id] || null;
    const eyebrow = (here ? '你在这一站' : prep ? '准备出发' : '下一站') + ' · 第 ' + (R.cur + 1) + ' / ' + R.n + ' 站';
    const meta = [str(s.where), str(s.road)];
    if (!here && !prep && num(s.km) != null) meta.push('还有 ' + r1(Math.max(0, s.km - R.passedKm)) + ' km');

    const stats = [], reserve = num(P.car && P.car.reservePct);
    let arriveBase = null;   // 到这一站时的电量（实际记的 > 按上一站实际推的 > 计划的），睡觉站拿它扣睡觉耗的电
    if (prep) {
      stats.push({ k: '计划出发', v: C.fmtHM(row.leave), sub: shiftSub(row.leave, row.planLeave, t) });
      const soc0 = num(P.startSoc) != null ? P.startSoc : num(s.socLeave);
      if (need) {
        const z = sleepLeft(need, soc0);
        stats.push({ k: '出发至少要有', v: need.minPct, unit: '%', cls: need.capped ? 'danger' : 'hot',
          sub: need.capped ? '<span class="late">充满也不够留 ' + need.reserve + '%</span>'
            : soc0 != null ? '按计划 ' + soc0 + '% 出发，到' + esc(need.toName) + '剩约 ' + arriveLeft(need, soc0) + '%' + (z != null ? '，睡一觉约剩 ' + z + '%' : '') : '' });
      } else if (soc0 != null) stats.push({ k: '计划出发电量', v: soc0, unit: '%' });
    } else if (here) {
      if (s.type === 'wait' && exitAt != null) {
        stats.push(t < exitAt
          ? { k: '还要等', v: durLeft(exitAt - t), cls: 'hot', wide: true, sub: '手机显示 ' + esc(C.fmtHM(exitAt)) + ' 以后再开出服务区' }
          : { k: '可以走了', v: '已过 ' + C.fmtClockWord(exitAt), cls: 'hot', wide: true, sub: '现在开出服务区、出收费站都免费' });
      } else if (row.mode === 'both' && num(row.leave) != null) {
        stats.push({ k: '计划走', v: C.fmtHM(row.leave), sub: shiftSub(row.leave, row.planLeave, t) });
      }
      if (row.rec && num(row.rec.arriveSoc) != null) {
        arriveBase = row.rec.arriveSoc;
        stats.push({ k: '到站电量', v: row.rec.arriveSoc, unit: '%', sub: '已记下 · ' + esc(C.fmtHM(row.rec.arriveAt)) + ' 到的' });
      }
    } else {
      stats.push({ k: '预计到', v: C.fmtHM(row.arrive), sub: shiftSub(row.arrive, row.planArrive, t) });
      if (R.projArrive != null) {
        arriveBase = R.projArrive;
        stats.push({ k: '预计到站电量', v: R.projArrive, unit: '%', cls: reserve != null && R.projArrive < reserve ? 'danger' : '', sub: '按上一站实际电量算' });
      } else if (num(s.socArrive) != null) {
        arriveBase = s.socArrive;
        stats.push({ k: '计划到站电量', v: s.socArrive, unit: '%' });
      }
    }
    // 睡觉站先睡后充：到站电量扣掉露营模式开空调耗的电，才是开始充电时的电量
    const sp = C.sleepPct(s);
    if (!prep && sp > 0 && arriveBase != null) {
      const left = Math.floor(arriveBase - sp + EPS), low = reserve != null && left < reserve;
      stats.push({ k: '睡一觉约剩', v: left, unit: '%', cls: low ? 'danger' : '',
        sub: '露营模式约耗 ' + r1(sp) + '%' + (low ? '<br><span class="late">低于要留的 ' + reserve + '%</span>' : '') });
    }
    if (!prep && C.isCharging(s)) chargeStats(R, row, need).forEach(x => stats.push(x));

    const alerts = [];
    if (!prep && C.isCharging(s)) { const sa = saNotice(s); if (sa) alerts.push(sa); }
    if (s.type === 'exit' && exitAt != null && t < exitAt) {
      alerts.push('<div class="notice bad"><b>还没到 ' + esc(C.fmtClockWord(exitAt)) + '，先别出收费站</b>（还差 ' + esc(durLeft(exitAt - t))
        + '）。早出一分钟，这一趟的高速费就不免了。</div>');
    }
    const f = R.forecast;
    if (s.type === 'wait' && !here && f && f.idx === row.idx) {
      alerts.push(f.early
        ? '<div class="notice accent">到了在这里等到 ' + esc(C.fmtHM(exitAt)) + ' 以后再开出服务区（大约等 ' + esc(durLeft(f.waitMs)) + '）。</div>'
        : '<div class="notice ok">预计 ' + esc(C.fmtClockWord(exitAt)) + '以后才到：不用等，直接走，照样免费。</div>');
    }

    const parts = [];
    const todo = todoList(s);
    if (todo.length) parts.push('<div class="block"><h3>要做的事</h3><ul class="todo">' + todo.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>');
    const chg = chargerHtml(s);
    if (chg) parts.push('<div class="block"><h3>' + (usesSA(s) ? '在哪充' : '用哪家充') + '</h3>' + chg + '</div>');
    if (str(s.backup)) parts.push('<div class="block"><h3>排队 / 坏了怎么办</h3><div class="backup">' + esc(s.backup) + '</div></div>');

    let btns;
    if (here) btns = '<div class="btns one">' + checkBtn(row, 'leave', 'primary') + '</div>';
    else {
      const nav = navBtn(s.nav);
      btns = '<div class="btns' + (nav ? '' : ' one') + '">' + nav + checkBtn(row, firstKind(row), 'primary') + '</div>';
    }
    const copy = here ? '' : copyBtn(navName(s.nav, s.name));
    const chips = here ? recordChips(row) : '';

    return '<section class="hero">'
      + '<div class="ghost">' + icon(ti.icon) + '</div>'
      + '<div class="eyebrow">' + esc(eyebrow) + badge(s.type, true) + (prep ? '' : saTag(s)) + '</div>'
      + '<h2>' + esc(str(s.name) || '（没写站名）') + '</h2>'
      + (meta.filter(Boolean).length ? '<p class="meta">' + esc(meta.filter(Boolean).join(' · ')) + '</p>' : '')
      + (str(s.note) ? '<p class="meta">' + esc(s.note) + '</p>' : '')
      + alerts.join('')
      + statsHtml(stats)
      + parts.join('')
      + btns
      + (copy ? '<div class="copy-row">' + copy + '</div>' : '')
      + (chips ? '<div class="chips">' + chips + '</div>' : '')
      + '</section>';
  }

  function doneHtml(R, t) {
    const row = R.rows[R.n - 1], s = row.stop, todo = todoList(s), nav = navBtn(s.nav);
    const meta = [when(row.arrive, t) ? when(row.arrive, t) + ' 到的' : '', num(R.totalKm) != null ? '全程 ' + r1(R.totalKm) + ' km' : ''].filter(Boolean);
    const chips = recordChips(row);
    return '<section class="hero"><div class="ghost">' + icon('pin') + '</div>'
      + '<div class="eyebrow">到了 · ' + R.n + ' 站全部走完</div>'
      + '<h2>' + esc(str(s.name)) + '</h2>'
      + (meta.length ? '<p class="meta">' + esc(meta.join(' · ')) + '</p>' : '')
      + (todo.length ? '<div class="block"><h3>要做的事</h3><ul class="todo">' + todo.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '')
      + (nav ? '<div class="btns one">' + nav + '</div>' : '')
      + (chips ? '<div class="chips">' + chips + '</div>' : '')
      + '</section>';
  }

  // 等 0 点：按平移后的时间，早到就在等 0 点的站等；晚到就直接出站
  function forecastHtml(R, t) {
    const f = R.forecast;
    if (!f || R.exitAt == null) return '';
    const st = R.rows[f.idx].status;
    if (st === 'done' || st === 'skipped' || st === 'here') return '';   // 人已经在那一站：大卡里有「还要等」
    const clock = C.fmtHM(R.exitAt), word = C.fmtClockWord(R.exitAt), at = when(f.arrive, t), name = str(f.name);
    const head = '<section class="card"><h3>' + esc(word) + '出站</h3><div class="fc-when num">' + esc(at) + '</div>';
    if (f.early) {
      const how = f.kind === 'wait' ? '在那里等到 ' + clock + ' 以后再开出服务区' : '比 ' + word + '早：路上找个服务区，等到 ' + clock + ' 以后再出收费站';
      return head + '<p class="fc-text">预计 ' + esc(at) + ' 到' + esc(name) + '，' + esc(how) + '</p>'
        + '<p class="fc-sub">大约要等 ' + esc(durLeft(f.waitMs)) + '</p></section>';
    }
    return head + '<p class="fc-text">预计 ' + esc(word) + '以后才到，直接出站，照样免费</p>'
      + '<p class="fc-sub">预计 ' + esc(at) + ' 到' + esc(name) + '</p></section>';
  }

  function progressHtml(R) {
    const total = num(R.totalKm), passed = num(R.passedKm) || 0;
    const pct = total > 0 ? Math.max(0, Math.min(1, passed / total)) : 0;
    const big = R.done ? R.n : R.lastIdx < 0 ? 0 : R.cur + 1;
    const note = R.done ? '全部走完' : R.lastIdx < 0 ? '还没出发' : '第 ' + (R.cur + 1) + ' 站 · 共 ' + R.n + ' 站';
    return '<section class="card"><h3>进度</h3><div class="prog-top">'
      + '<div><div class="v num">' + big + '<small> / ' + R.n + ' 站</small></div><p class="meta">' + esc(note) + '</p></div>'
      + (total != null ? '<div class="right"><div class="v num">' + r1(passed) + '<small> km</small></div><p class="meta">已走 · 共 ' + r1(total) + ' km</p></div>' : '')
      + '</div><div class="bar"><i style="width:' + (pct * 100).toFixed(1) + '%"></i></div></section>';
  }

  function energyHtml(R) {
    const e = R.energy;
    const eff = e.nextLeg && num(e.nextLeg.eff) != null ? e.nextLeg.eff : e.planKmPerPct;
    if (eff == null) return '';
    const planLeg = e.nextLeg && num(e.nextLeg.plan) != null ? e.nextLeg.plan : e.planKmPerPct;
    const nm = i => esc(str(R.rows[i] && R.rows[i].stop.name));
    const seg = x => nm(x.fromIdx) + ' → ' + nm(x.toIdx) + '，' + r1(x.km) + ' km 用掉 ' + r1(x.used) + '%';
    const lines = [];
    if (e.measured != null && e.last) {
      lines.push('实测：' + seg(e.last) + '，每 1% 跑 <b>' + r1(e.measured) + '</b> km');
      if (planLeg != null) lines.push('下一段计划按 ' + r1(planLeg) + ' 算；跟实测比取小的（保守），按 <b>' + r1(eff) + '</b> 算');
    } else if (!e.bad) {
      lines.push('还没有实测：出发时记下电量、到下一站再记一次，就能算出这段实际多耗电');
      if (planLeg != null && e.planKmPerPct != null && planLeg < e.planKmPerPct - 0.005) lines.push('下一段比平路耗电，计划按 ' + r1(planLeg) + ' 算');
    }
    const bad = e.bad && e.last ? '<div class="notice warn"><b>这段电量数字不对，按计划值算</b>（记的是 ' + seg(e.last)
      + '）。要是记错了，去「行程」里改那两次打卡。</div>' : '';
    return '<section class="card"><h3>能耗 · 每 1% 电跑多少 km</h3><div class="fc-when num">' + r1(eff) + '<small>km / 1%</small></div>'
      + bad + lines.map(l => '<p class="line">' + l + '</p>').join('') + '</section>';
  }

  const nowHtml = (R, t) => pageHead(str(P.title), str(P.subtitle)) + stripHtml(R) + exitWarnHtml(R, t) + heroHtml(R, t)
    + forecastHtml(R, t) + progressHtml(R) + energyHtml(R);

  // ---------- 页：行程（一根竖时间轴，按天分组） ----------
  function tlItemHtml(R, row, t, isFirst, isLast) {
    const s = row.stop, st = row.status, live = st === 'next' || st === 'here', past = st === 'done' || st === 'skipped';
    const main = row.mode === 'leave' ? row.leave : row.arrive;
    const planned = row.mode === 'leave' ? row.planLeave : row.planArrive;
    const actual = row.mode === 'leave' ? row.leaveActual : row.arriveActual;
    const tag = row.mode === 'leave' ? '出发' : row.mode === 'pass' ? '出站' : '到';

    const sub = [];
    if (row.mode === 'both' && num(row.leave) != null) {
      let x = '→ ' + C.fmtHM(row.leave) + ' 走';
      if (num(row.arrive) != null && row.leave - row.arrive >= MIN) x += ' · 停 ' + C.fmtDur(row.leave - row.arrive);
      sub.push(esc(x));
    }
    if (actual) sub.push('<span class="ok-t">已打卡</span>');
    else if (num(main) != null && num(planned) != null && Math.abs(main - planned) >= MIN) {
      sub.push('<span class="' + (main > planned ? 'late' : 'early') + '">' + esc(C.fmtShift(main - planned)) + '</span>', '原计划 ' + esc(C.fmtHM(planned)));
    }
    const meta = [str(s.where), str(s.road), num(s.km) != null ? r1(s.km) + ' km' : ''].filter(Boolean).join(' · ');

    const pa = num(s.socArrive), pl = num(s.socLeave), sp = C.sleepPct(s), charging = C.isCharging(s);
    const chargeTo = num(s.chargeTo) != null ? s.chargeTo : pl;
    let soc = '';
    if (row.mode === 'leave') { const v = pl != null ? pl : num(P.startSoc); if (v != null) soc = '计划电量：出发 ' + v + '%'; }
    else if (sp > 0 && pa != null) {
      // 睡觉站先睡后充：「到站 39% → 睡一觉约剩 31% → 充到 90%」
      soc = '计划电量：到站 ' + pa + '% → 睡一觉约剩 ' + Math.floor(pa - sp + EPS) + '%' + (charging && chargeTo != null ? ' → 充到 ' + chargeTo + '%' : '');
    } else if (row.mode === 'both' && pa != null && pl != null) soc = '计划电量：到站 ' + pa + '% → ' + (charging ? '充到 ' : '离站 ') + pl + '%';
    else if (pa != null) soc = '计划到站电量 ' + pa + '%';

    const need = R.needs[row.id];
    let needLine = '';
    if (need && !past) {
      needLine = need.capped
        ? '<p class="line late">充满也不够：' + needWhy(need) + '，加起来超过 100%，中途得多充一次</p>'
        : '<p class="line">' + (row.mode === 'leave' ? '出发至少要有' : '至少充到') + ' <b>' + need.minPct + '%</b>（' + needWhy(need) + '）</p>';
    }
    const todo = past ? [] : todoList(s);
    const fid = 'b:' + row.id;
    const fold = str(s.backup) && !past
      ? '<details class="fold" data-fold="' + esc(fid) + '"' + (state.open[fid] ? ' open' : '') + '><summary>备用方案</summary><div class="fold-body">' + esc(s.backup) + '</div></details>' : '';

    const acts = [];
    if (st === 'next') acts.push(navBtn(s.nav, 'small'), checkBtn(row, firstKind(row), 'primary small'));
    else if (st === 'here') acts.push(recordChips(row), checkBtn(row, 'leave', 'primary small'));
    else if (st === 'todo') acts.push(navBtn(s.nav, 'small'), checkBtn(row, firstKind(row), 'small'));
    else if (st === 'done') {
      acts.push(recordChips(row));
      // 到了没按「出发」、或者只按了「出发」：给个补记的口子（不补，这一段的实测耗电就算不出来）
      if (row.mode === 'both' && !row.leaveActual) acts.push(checkBtn(row, 'leave', 'ghost small', '补记出发'));
      if (row.mode === 'both' && !row.arriveActual) acts.push(checkBtn(row, 'arrive', 'ghost small', '补记到站'));
    } else if (st === 'skipped') acts.push('<span class="skip-t">没打卡</span>', checkBtn(row, firstKind(row), 'ghost small', '补记'));
    if (!past && obj(s.nav)) acts.push(copyBtn(navName(s.nav, s.name), 'small'));

    const sa = charging && usesSA(s);
    return '<li class="tl-item ' + st + (isFirst ? ' first' : '') + (isLast ? ' last' : '') + '"><span class="tl-dot"></span><div class="tl-card' + (sa ? ' sa' : '') + '">'
      + '<div class="tl-head"><div class="tl-time num">' + esc(C.fmtHM(main)) + '<small>' + tag + '</small></div>' + badge(s.type, live) + '</div>'
      + '<div class="tl-name">' + esc(str(s.name) || '（没写站名）') + (sa ? saTag(s) : '') + '</div>'
      + (meta ? '<p class="meta">' + esc(meta) + '</p>' : '')
      + (sub.length ? '<p class="meta">' + sub.join(' · ') + '</p>' : '')
      + (soc ? '<p class="line">' + esc(soc) + '</p>' : '')
      + needLine
      + (sa && !past ? saNotice(s) : '')
      + (past ? '' : chargerHtml(s))
      + (todo.length ? '<p class="line muted">要做：' + esc(todo.join(' · ')) + '</p>' : '')
      + (str(s.note) && !past ? '<p class="line muted">' + esc(s.note) + '</p>' : '')
      + fold
      + (acts.filter(Boolean).length ? '<div class="tl-actions">' + acts.filter(Boolean).join('') + '</div>' : '')
      + '</div></li>';
  }

  function tripHtml(R, t) {
    const sub = ['共 ' + R.n + ' 站'];
    if (num(R.totalKm) != null) sub.push(r1(R.totalKm) + ' km');
    const today = C.dayKey(t);
    let lastDay = null, items = '';
    R.rows.forEach((row, i) => {
      const tm = row.mode === 'leave' ? row.leave : row.arrive;
      if (num(tm) != null && C.dayKey(tm) !== lastDay) {
        lastDay = C.dayKey(tm);
        const past = row.status === 'done' || row.status === 'skipped';
        items += '<li class="day' + (i === 0 ? ' first' : '') + (past ? ' done' : '') + '">'
          + esc(C.fmtMD(tm) + ' ' + C.fmtWeek(tm) + (lastDay === today ? ' · 今天' : '')) + '</li>';
      }
      items += tlItemHtml(R, row, t, i === 0, i === R.n - 1);
    });
    return pageHead('行程', sub.join(' · ')) + '<ol class="tl">' + items + '</ol>';
  }

  // ---------- 页：规矩（规矩、清单、目的地、设置） ----------
  const clId = (x, i) => str(x.id) || '#' + i;
  function checklistItems() { return arr(P.checklist).filter(x => obj(x) && str(x.text)); }
  const clDone = list => list.filter((x, i) => state.cl[clId(x, i)]).length;

  function rulesHtml(R) {
    const rules = arr(P.rules).map(r => (typeof r === 'string' ? { body: r } : obj(r))).filter(r => r && (str(r.title) || str(r.body)));
    const list = checklistItems();
    const sub = [];
    if (rules.length) sub.push(rules.length + ' 条规矩');
    if (list.length) sub.push('清单 ' + clDone(list) + ' / ' + list.length);
    let h = pageHead('规矩', sub.join(' · '));
    h += rules.map(r => '<article class="rule">' + (str(r.title) ? '<h3>' + esc(r.title) + '</h3>' : '') + (str(r.body) ? '<p>' + esc(r.body) + '</p>' : '') + '</article>').join('');

    if (list.length) {
      const groups = [], by = {};
      list.forEach((x, i) => { const w = str(x.when); if (!by[w]) { by[w] = []; groups.push(w); } by[w].push([x, i]); });
      h += '<h2 class="sec">清单 · <span id="cl-count">' + clDone(list) + ' / ' + list.length + '</span></h2><div class="checks">'
        + groups.map(w => (w ? '<div class="check-when">' + esc(w) + '</div>' : '') + by[w].map(([x, i]) => {
          const id = clId(x, i), on = !!state.cl[id];
          return '<button type="button" class="check-row' + (on ? ' on' : '') + '" role="checkbox" aria-checked="' + on + '" data-act="cl" data-id="' + esc(id) + '">'
            + '<span class="box"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS.check + '</svg></span><span class="txt">' + esc(x.text) + '</span></button>';
        }).join('')).join('') + '</div>';
    }

    const places = arr(P.places).filter(p => obj(p) && (str(p.name) || str(p.addr)));
    if (places.length) {
      h += '<h2 class="sec">目的地</h2>' + places.map(p => {
        const kv = [];
        if (str(p.addr)) kv.push(['地址', p.addr]);
        if (str(p.hours)) kv.push(['营业', p.hours]);
        if (str(p.phone)) kv.push(['电话', p.phone]);
        const tel = (str(p.phone).match(/\+?\d[\d-]{5,}\d/) || [''])[0].replace(/-/g, '');
        const btns = [navBtn(p.nav), tel ? '<a class="btn" href="tel:' + esc(tel) + '">' + icon('phone') + '打电话</a>' : ''].filter(Boolean);
        const copy = copyBtn(navName(p.nav, p.name));
        return '<article class="place"><h3>' + esc(str(p.name)) + '</h3>'
          + (kv.length ? '<dl class="kv">' + kv.map(([k, v]) => '<dt>' + k + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' : '')
          + (str(p.note) ? '<p class="small-print">' + esc(p.note) + '</p>' : '')
          + (btns.length ? '<div class="btns' + (btns.length === 1 ? ' one' : '') + '">' + btns.join('') + '</div>' : '')
          + (copy ? '<div class="copy-row">' + copy + '</div>' : '') + '</article>';
      }).join('');
    }

    const cnt = Object.keys(state.ck).length;
    const sw = !('serviceWorker' in navigator) ? '这个浏览器不支持断网打开'
      : navigator.serviceWorker.controller ? '断网也能打开' : '还没存进手机：联网再打开一次就好';
    h += '<h2 class="sec">设置</h2><div class="card"><dl class="kv">'
      + (str(P.version) ? '<dt>计划版本</dt><dd>' + esc(P.version) + '</dd>' : '')
      + '<dt>离线版本</dt><dd id="sw-ver">…</dd>'
      + '<dt>离线</dt><dd>' + esc(sw) + '</dd>'
      + '<dt>打卡</dt><dd>' + (cnt ? '记了 ' + cnt + ' 个站' : '还没打卡') + (store.ok ? '' : '（这台手机存不下，关掉就没了）') + '</dd>'
      + '</dl><div class="btns one"><button type="button" class="btn danger" data-act="clear"' + (cnt ? '' : ' disabled') + '>清空打卡</button></div></div>';
    return h;
  }

  // 离线版本号 = sw.js 里的 VERSION（缓存名是「zijia-版本号」，跟 sw.js 的写法对上）
  function fillSwVersion() {
    const put = text => { const el = $('sw-ver'); if (el) el.textContent = text; };
    if (!('caches' in window)) { put('这个浏览器存不了'); return; }
    caches.keys().then(keys => {
      const mine = keys.filter(k => k.indexOf('zijia-') === 0).map(k => k.slice(6));
      put(mine.length ? mine.join('、') : '还没存好（联网打开一次就会存）');
    }).catch(() => put('读不到'));
  }

  // ---------- 顶上的提醒（每页都有） ----------
  function noticesHtml(R) {
    const out = [];
    if (!store.ok) out.push('<div class="notice warn">这台手机现在存不了打卡记录：打的卡只在这次打开时有效，关掉就没了。计划照常能看。</div>');
    if (store.broken.length) out.push('<div class="notice warn">之前存的记录读不出来（格式坏了），先当作没有。</div>');
    if (R.dupIds.length) out.push('<div class="notice bad">计划里有重复的站编号（' + esc(R.dupIds.join('、')) + '），在这些站打卡会记混。截图告诉 Claude 改。</div>');
    return out.join('');
  }

  // ---------- 画页面 ----------
  function render(animate) {
    const t = Date.now();
    try {
      const R = C.compute(P, state.ck, t);
      $('notices').innerHTML = noticesHtml(R);
      view.innerHTML = state.tab === 'trip' ? tripHtml(R, t) : state.tab === 'rules' ? rulesHtml(R) : nowHtml(R, t);
    } catch (err) {
      console.error('页面画不出来', err);
      view.innerHTML = '<div class="notice bad"><b>这一页画不出来</b>：' + esc(err && err.message ? err.message : err) + '。多半是计划数据格式不对，截图告诉 Claude。</div>';
    }
    view.classList.remove('enter');
    if (animate) { void view.offsetWidth; view.classList.add('enter'); }
    if (state.tab === 'rules') fillSwVersion();
  }

  function setTab(name) {
    if (['now', 'trip', 'rules'].indexOf(name) < 0) return;
    const same = state.tab === name;
    state.tab = name;
    document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === name)));
    if (same) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }   // 再点一下当前页 = 回到顶上
    render(true);
    window.scrollTo(0, 0);
    if (name === 'trip') {   // 行程长：直接滚到下一站那里
      const cur = view.querySelector('.tl-item.next, .tl-item.here');
      if (cur && cur.getBoundingClientRect().top > window.innerHeight * 0.55) cur.scrollIntoView({ block: 'center' });
    }
  }

  // ---------- 弹层（从下面滑上来；点背景、按住把手往下拖、按 Esc 都能关） ----------
  const sheetWrap = $('sheet'), sheetEl = sheetWrap.querySelector('.sheet'), sheetBody = $('sheet-body');
  let sheetCtx = null, sheetOpen = false, hideTimer = 0;
  function openSheet(html, ctx) {
    clearTimeout(hideTimer);
    sheetBody.innerHTML = html;
    sheetCtx = ctx || null;
    sheetEl.style.transform = '';
    sheetEl.style.transition = '';
    sheetWrap.classList.remove('hide');
    sheetWrap.setAttribute('aria-hidden', 'false');
    void sheetWrap.offsetWidth;   // 先让它出现在页面上再加 on，才有滑上来的动画
    sheetWrap.classList.add('on');
    sheetOpen = true;
    document.documentElement.classList.add('sheet-lock');
    fitViewport();
  }
  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    sheetCtx = null;
    const a = document.activeElement;
    if (a && sheetWrap.contains(a) && a.blur) a.blur();
    sheetWrap.classList.remove('on');
    sheetWrap.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('sheet-lock');
    sheetEl.style.transform = '';
    hideTimer = setTimeout(() => { if (!sheetOpen) { sheetWrap.classList.add('hide'); sheetBody.innerHTML = ''; } }, 450);
  }
  // 键盘弹出来时把弹层顶到键盘上面（iPhone 上键盘盖在页面上，不会把页面挤短）
  function fitViewport() {
    const vv = window.visualViewport, rs = document.documentElement.style;
    if (!vv) return;
    const kb = Math.max(0, Math.round(document.documentElement.clientHeight - vv.height - vv.offsetTop));
    rs.setProperty('--kb', kb + 'px');
    rs.setProperty('--vvh', Math.round(vv.height) + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  (function dragToClose() {
    let y0 = null, dy = 0, pid = null;
    sheetWrap.addEventListener('pointerdown', e => {
      if (!sheetOpen || !e.target.closest('.sh-drag')) return;
      y0 = e.clientY; dy = 0; pid = e.pointerId;
      sheetEl.style.transition = 'none';
      try { e.target.setPointerCapture(pid); } catch (err) { /* 抓不住也能拖，只是手指滑出弹层会断 */ }
    });
    sheetWrap.addEventListener('pointermove', e => {
      if (y0 == null || e.pointerId !== pid) return;
      dy = Math.max(0, e.clientY - y0);
      sheetEl.style.transform = 'translate(-50%, ' + dy + 'px)';
    });
    const end = e => {
      if (y0 == null || e.pointerId !== pid) return;
      y0 = null;
      sheetEl.style.transition = '';
      if (dy > 90) closeSheet(); else sheetEl.style.transform = '';
    };
    sheetWrap.addEventListener('pointerup', end);
    sheetWrap.addEventListener('pointercancel', end);
  })();

  // ---------- 打卡 ----------
  function draftCk(id, kind, at, soc) {
    const next = {};
    Object.keys(state.ck).forEach(k => { next[k] = Object.assign({}, state.ck[k]); });
    const r = next[id] || {};
    if (kind !== 'leave') { r.arriveAt = at; if (soc != null) r.arriveSoc = soc; else delete r.arriveSoc; }
    if (kind !== 'arrive') { r.leaveAt = at; if (soc != null) r.leaveSoc = soc; else delete r.leaveSoc; }
    next[id] = r;
    return next;
  }

  function openCheck(idx, kind, edit) {
    if (!KIND_LABEL[kind]) return;
    const t = Date.now(), R = C.compute(P, state.ck, t), row = R.rows[idx];
    if (!row) return;
    const s = row.stop, rec = state.ck[row.id] || {}, ti = typeInfo(s.type);
    const had = kind === 'leave' ? rec.leaveAt != null : rec.arriveAt != null;
    edit = !!edit && had;
    const at0 = edit ? (kind === 'leave' ? rec.leaveAt : rec.arriveAt) : t;
    const soc0 = edit ? (kind === 'leave' ? rec.leaveSoc : rec.arriveSoc) : null;
    const chargeLeave = kind === 'leave' && s.type !== 'start' && C.isCharging(s);
    const title = (kind === 'leave' ? (s.type === 'start' ? '出发' : '从这里出发') : kind === 'pass' ? '出收费站' : '到了') + (edit ? ' · 改记录' : '');
    const socLab = chargeLeave ? '充到了' : s.type === 'start' ? '出发电量' : '现在电量';
    const planT = kind === 'leave' ? row.planLeave : row.planArrive;
    let planSoc = kind === 'leave' ? (num(s.chargeTo) != null ? s.chargeTo : num(s.socLeave)) : num(s.socArrive);
    if (planSoc == null && kind === 'leave' && s.type === 'start') planSoc = num(P.startSoc);
    const meta = [str(s.name)];
    if (num(planT) != null) meta.push('计划 ' + when(planT, t));
    if (planSoc != null) meta.push((kind === 'leave' ? (chargeLeave ? '计划充到 ' : '计划电量 ') : '计划到站电量 ') + planSoc + '%');

    openSheet('<div class="sh-drag"><div class="grab"></div><div class="sh-head">' + badge(s.type, true)
      + '<h2 id="sh-title">' + esc(title) + '</h2><p class="meta">' + esc(meta.filter(Boolean).join(' · ')) + '</p></div></div>'
      + '<form id="ck-form" novalidate autocomplete="off">'
      + '<label class="soc-input"><span class="lab">' + esc(socLab) + '</span>'
      + '<input id="ck-soc" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" enterkeyhint="done" placeholder="0–100" aria-label="' + esc(socLab) + '，0 到 100"'
      + ' value="' + (num(soc0) != null ? soc0 : '') + '"><span class="unit">%</span></label>'
      + '<label class="field"><span>时间</span><input id="ck-time" type="datetime-local" value="' + esc(C.toInput(at0)) + '"></label>'
      + (kind === 'arrive' && C.sleepPct(s) > 0 ? '<p class="f-hint">到了先记电量再睡：睡觉耗的电不能算进开车的能耗</p>' : '')
      + '<div id="ck-warn" aria-live="polite"></div>'
      + '<div class="btns one"><button type="submit" class="btn primary" id="ck-save" disabled>' + esc(edit ? '改好了' : '记下：' + KIND_LABEL[kind]) + '</button>'
      + (edit ? '<button type="button" class="btn danger" data-act="ck-del">删掉这条记录</button>' : '')
      + '<button type="button" class="btn ghost" data-act="sheet-close">取消</button></div></form>',
      { idx, id: row.id, kind, edit, R0: R });
    const soc = $('ck-soc');
    try { soc.focus({ preventScroll: true }); } catch (e) { soc.focus(); }
    if (soc.value) { try { soc.setSelectionRange(0, soc.value.length); } catch (e) { /* 选不中不要紧 */ } }
    checkVerdict();
  }

  function readForm() {
    const socEl = $('ck-soc'), timeEl = $('ck-time');
    const raw = socEl ? socEl.value.trim() : '';
    const socOk = /^\d{1,3}$/.test(raw) && +raw <= 100;
    return { raw, socOk, soc: socOk ? +raw : null, at: timeEl ? C.fromInput(timeEl.value) : null };
  }

  // 边填边提醒：跳站、离站电量不够、电量跟上一站对不上、早于 0 点出站。只有「填得不对」才不让存。
  function checkVerdict() {
    const ctx = sheetCtx;
    if (!ctx || !ctx.kind) return { block: true };
    const f = readForm(), msgs = [];
    let block = !f.socOk;
    if (f.raw && !f.socOk) msgs.push(['bad', '电量填 0 到 100 之间的整数']);
    if (f.at == null) { msgs.push(['bad', '时间没填对']); block = true; }
    else {
      const rec = state.ck[ctx.id] || {}, R0 = ctx.R0, row0 = R0.rows[ctx.idx];
      if (ctx.kind === 'leave' && rec.arriveAt != null && f.at < rec.arriveAt) { msgs.push(['bad', '出发时间早于到站时间（' + C.fmtHM(rec.arriveAt) + '），改一下时间']); block = true; }
      if (ctx.kind === 'arrive' && rec.leaveAt != null && f.at > rec.leaveAt) { msgs.push(['bad', '到站时间晚于出发时间（' + C.fmtHM(rec.leaveAt) + '），改一下时间']); block = true; }
      const R2 = C.compute(P, draftCk(ctx.id, ctx.kind, f.at, f.soc), Date.now());
      if (!ctx.edit) {
        const skipped = R2.rows.filter(r => r.status === 'skipped' && R0.rows[r.idx].status !== 'skipped' && R0.rows[r.idx].status !== 'done');
        if (skipped.length) msgs.push(['warn', '会跳过 ' + skipped.length + ' 站：' + skipped.map(r => str(r.stop.name) || r.id).join('、') + '。它们算没打卡，之后在「行程」里还能补记。']);
      }
      if (f.soc != null && ctx.kind === 'leave') {
        const nd = R2.needs[ctx.id];
        if (nd && f.soc < nd.minPct) {
          msgs.push(['bad', '比至少要' + (row0.stop.type === 'start' ? '有' : '充') + '的 ' + nd.minPct + '% 少：开到' + nd.toName + '只剩约 ' + nd.arrivePct + '%'
            + (nd.afterSleepPct != null ? '，睡一觉约剩 ' + nd.afterSleepPct + '%' : '') + '（要留 ' + nd.reserve + '%）']);
        }
      }
      if (f.soc != null && ctx.kind !== 'leave') {
        const last = R2.energy.last;
        if (last && last.toIdx === ctx.idx && !last.ok) msgs.push(['warn', '这个电量跟上一站对不上（' + r1(last.km) + ' km 用掉 ' + r1(last.used) + '%）。没填错就照样记，能耗会按计划值算。']);
        // 睡觉站先睡后充：告诉他睡醒大概剩多少
        const sp = C.sleepPct(row0.stop), rs = num(P.car && P.car.reservePct);
        if (ctx.kind === 'arrive' && sp > 0) {
          const left = Math.floor(f.soc - sp + EPS), low = rs != null && left < rs;
          msgs.push([low ? 'warn' : '', '睡一觉约剩 ' + left + '%（露营模式约耗 ' + r1(sp) + '%）' + (low ? '，低于要留的 ' + rs + '%' : '')]);
        }
      }
      if (R2.exitAt != null && R2.exitIdx >= 0 && ctx.kind !== 'arrive') {
        const xr = R2.rows[R2.exitIdx];
        if (ctx.idx === R2.exitIdx && f.at < R2.exitAt) msgs.push(['bad', '这个时间还没到 ' + C.fmtHM(R2.exitAt) + '：这时候出收费站，高速费不免。']);
        else if (ctx.idx < R2.exitIdx && R2.exitEarly) {
          msgs.push(['bad', '按这个时间走，预计 ' + when(xr.arrive, Date.now()) + ' 就到' + (str(xr.stop.name) || '收费站') + '，早于 ' + C.fmtClockWord(R2.exitAt)
            + '。在服务区等到 ' + C.fmtHM(R2.exitAt) + ' 以后再走。']);
        }
      }
    }
    const box = $('ck-warn'), save = $('ck-save');
    if (box) box.innerHTML = msgs.map(m => '<div class="notice ' + m[0] + '">' + esc(m[1]) + '</div>').join('');
    if (save) save.disabled = block;
    return { block, f };
  }

  function commit(ck, msg) {
    state.ck = C.cleanCheckins(ck);
    const saved = store.set(KEY_CK, state.ck);
    closeSheet();
    render(false);
    toast(saved ? msg : msg + '（这台手机存不下，关掉就没了）');
  }

  function submitCheck() {
    const ctx = sheetCtx;
    if (!ctx || !ctx.kind) return;
    const v = checkVerdict();
    if (v.block) return;
    const next = draftCk(ctx.id, ctx.kind, v.f.at, v.f.soc);
    const R2 = C.compute(P, next, Date.now());
    const sh = R2.anchor ? C.fmtShift(R2.anchor.delta) : '';
    commit(next, sh === '准点' ? '记下了 · 跟计划一样准点' : sh ? '记下了 · 比计划' + sh : '记下了');
  }

  // 删一条记录要点两下：第一下按钮变成「再点一下，确认删掉」，3 秒内再点才删（防手滑）
  let delArmedAt = 0;
  function deleteRecord(btn) {
    const ctx = sheetCtx;
    if (!ctx || !ctx.edit) return;
    if (Date.now() - delArmedAt > 3000) {
      delArmedAt = Date.now();
      btn.textContent = '再点一下，确认删掉';
      setTimeout(() => { if (btn.isConnected && Date.now() - delArmedAt >= 3000) btn.textContent = '删掉这条记录'; }, 3050);
      return;
    }
    delArmedAt = 0;
    const ck = Object.assign({}, state.ck), r = Object.assign({}, ck[ctx.id]);
    if (ctx.kind !== 'leave') { delete r.arriveAt; delete r.arriveSoc; }
    if (ctx.kind !== 'arrive') { delete r.leaveAt; delete r.leaveSoc; }
    if (r.arriveAt == null && r.leaveAt == null) delete ck[ctx.id]; else ck[ctx.id] = r;
    commit(ck, '删掉了这条记录');
  }

  function openClear() {
    const cnt = Object.keys(state.ck).length;
    if (!cnt) return;
    openSheet('<div class="sh-drag"><div class="grab"></div><div class="sh-head"><h2 id="sh-title">清空所有打卡？</h2>'
      + '<p class="meta">' + cnt + ' 个站的打卡记录都会删掉，时间和电量回到原计划。删了找不回来。</p></div></div>'
      + '<div class="btns one"><button type="button" class="btn danger" data-act="clear-yes">清空</button>'
      + '<button type="button" class="btn ghost" data-act="sheet-close">不清空</button></div>', { clear: true });
  }

  // ---------- 清单勾选：只改这一行和计数，不整页重画 ----------
  function toggleCl(el) {
    const id = el.getAttribute('data-id');
    if (!id) return;
    if (state.cl[id]) delete state.cl[id]; else state.cl[id] = Date.now();
    const on = !!state.cl[id];
    el.classList.toggle('on', on);
    el.setAttribute('aria-checked', String(on));
    const list = checklistItems(), cnt = $('cl-count');
    if (cnt) cnt.textContent = clDone(list) + ' / ' + list.length;
    if (!store.set(KEY_CL, state.cl)) $('notices').innerHTML = noticesHtml(C.compute(P, state.ck, Date.now()));
  }

  // ---------- 复制 / 小提示 ----------
  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
  }
  function copyText(text) {
    if (!text) return;
    const done = ok => toast(ok ? '已复制：' + text : '复制不了，长按站名自己复制');
    const legacy = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) { /* 老浏览器没有 */ }
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true), () => done(legacy()));
    else done(legacy());
  }

  // ---------- 点哪儿干什么（全页一个监听） ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'tab') setTab(el.getAttribute('data-tab'));
    else if (act === 'check' || act === 'edit') openCheck(+el.getAttribute('data-idx'), el.getAttribute('data-kind'), act === 'edit');
    else if (act === 'copy') copyText(el.getAttribute('data-text') || '');
    else if (act === 'cl') toggleCl(el);
    else if (act === 'clear') openClear();
    else if (act === 'clear-yes') { if (sheetCtx && sheetCtx.clear) commit({}, '打卡都清空了，回到原计划'); }
    else if (act === 'ck-del') deleteRecord(el);
    else if (act === 'sheet-close') closeSheet();
    else if (act === 'reload') location.reload();
  });
  sheetBody.addEventListener('input', () => { if (sheetCtx && sheetCtx.kind) checkVerdict(); });
  sheetBody.addEventListener('change', () => { if (sheetCtx && sheetCtx.kind) checkVerdict(); });
  sheetBody.addEventListener('submit', e => { e.preventDefault(); submitCheck(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen) closeSheet(); });
  // 折叠块（备用方案）重画以后保持开合
  document.addEventListener('toggle', e => {
    const d = e.target, k = d && d.getAttribute && d.getAttribute('data-fold');
    if (!k) return;
    if (d.open) state.open[k] = 1; else delete state.open[k];
  }, true);

  // ---------- 离线：注册 sw.js；换了新版本出一条「点这里刷新」 ----------
  function setupOffline() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) $('update').classList.remove('hide');   // 第一次装好接管不算「新版本」
      if (state.tab === 'rules' && !sheetOpen) render(false);
    });
    const reg = () => navigator.serviceWorker.register('sw.js')
      .then(() => { if (state.tab === 'rules') fillSwVersion(); })
      .catch(err => console.warn('离线缓存没装上：', err && err.message ? err.message : err));
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
  }

  // ---------- 开始 ----------
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.insertAdjacentHTML('afterbegin', icon(b.getAttribute('data-tab'))));
  if (str(P.title)) document.title = str(P.title);
  render(true);
  setupOffline();
  // 倒计时、「现在几点」相关的字：20 秒重画一次；切回 app 立刻重画（弹层开着就不动，免得冲掉正在填的数）
  setInterval(() => { if (!sheetOpen && document.visibilityState !== 'hidden') render(false); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !sheetOpen) render(false); });
  window.addEventListener('pageshow', e => { if (e.persisted && !sheetOpen) render(false); });
})();
