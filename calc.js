// calc.js —— 打卡以后怎么重算（纯函数，界面和自测共用）
//
// ★ 不碰页面、不碰 localStorage、不自己看表：「现在几点」由调用方传进来（毫秒）。
//   所以 node 能直接跑自测：node "产品与组件/应用/Nathan 自驾/测试/calc.test.js"
//   浏览器里挂在 window.Calc，node 里是 module.exports。
// ★ 不许写死任何站名、时间、电量：全部从传进来的 plan 读（字段说明在 plan.js 顶部）。
// ★ 时刻一律按北京时间（+08:00）显示：手机时区设错了，显示也不会跟着错。
//
// 打卡记录的样子（app.js 存进 localStorage 的就是这个）：
//   { [站 id]: { arriveAt: 毫秒, arriveSoc: 0–100, leaveAt: 毫秒, leaveSoc: 0–100 } }   每一项都可以缺
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60 * 1000;
  const BJ = 8 * 60 * MIN;
  // 实测「每 1% 电跑多少 km」出了这个范围，就当是电量数字记错了，不用实测、按计划值算（兜底）
  const SANE_MIN = 2, SANE_MAX = 9;
  const EPS = 1e-9;

  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const isSoc = v => num(v) != null && v >= 0 && v <= 100;
  function ms(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  // 站没写 id 也要能打卡：退回用「#序号」
  const stopId = (s, i) => (s && s.id != null && s.id !== '' ? String(s.id) : '#' + i);

  // 这一站能不能充电：type=charge，或者列了充电站，或者写了要充到多少（睡觉的站通常也充）
  function isCharging(s) {
    if (!s) return false;
    if (s.type === 'charge') return true;
    if (s.charger && Array.isArray(s.charger.options) && s.charger.options.length) return true;
    return num(s.chargeTo) != null;
  }

  // 每种站怎么打卡：出发只按「出发」；目的地只按「我到了」；收费站一下就过（到 = 走）；其余先到再走
  function checkMode(s) {
    const t = s && s.type;
    if (t === 'start') return 'leave';
    if (t === 'dest') return 'arrive';
    if (t === 'exit') return 'pass';
    return 'both';
  }

  // 从 localStorage 读回来的东西不可信：只留格式对的（时间是数字、电量 0–100）
  function cleanCheckins(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(k => {
      const r = raw[k];
      if (!r || typeof r !== 'object') return;
      const c = {};
      if (num(r.arriveAt) != null) { c.arriveAt = r.arriveAt; if (isSoc(r.arriveSoc)) c.arriveSoc = r.arriveSoc; }
      if (num(r.leaveAt) != null) { c.leaveAt = r.leaveAt; if (isSoc(r.leaveSoc)) c.leaveSoc = r.leaveSoc; }
      if (c.arriveAt != null || c.leaveAt != null) out[k] = c;
    });
    return out;
  }

  // ---------------- 能耗 ----------------

  // 【到第 m 站这一段】规划用的每 1% 跑多少 km：那一站的 legKmPerPct（山区、冷的路段更小），没有就用 car.kmPerPct
  function legPlan(plan, m) {
    const s = plan.stops[m], car = plan.car || {};
    if (num(s && s.legKmPerPct) > 0) return s.legKmPerPct;
    return num(car.kmPerPct) > 0 ? car.kmPerPct : null;
  }
  // 这一段实际按多少算：有实测就跟这一段的计划值比，取小的（保守）；没有实测就用计划值
  function legEff(plan, m, measured) {
    const p = legPlan(plan, m);
    if (!(measured > 0)) return p;
    return p == null ? measured : Math.min(p, measured);
  }
  // 从第 i 站开到第 j 站（i < j）要用掉多少 %；中间哪一站缺里程、或者没有能耗数，就返回 null（不瞎算）
  function usePct(plan, i, j, measured) {
    if (!(j > i)) return null;
    let sum = 0;
    for (let m = i + 1; m <= j; m++) {
      const a = num(plan.stops[m - 1].km), b = num(plan.stops[m].km), k = legEff(plan, m, measured);
      if (a == null || b == null || !(k > 0)) return null;
      sum += Math.max(0, b - a) / k;
    }
    return sum;
  }

  // 实测：上一站「实际离站电量」− 这一站「实际到站电量」= 用掉的 %；这一段 km ÷ 用掉的 % = 实测每 1% 跑多少 km。
  // 只认最近的一段。用掉 ≤ 0、或者算出来不在 SANE_MIN–SANE_MAX 之间 → 这段不算数（bad），按计划值算。
  function measure(plan, ck, ids) {
    const stops = plan.stops, segs = [];
    let from = null;   // 上一个有「实际离站电量」的站
    for (let i = 0; i < stops.length; i++) {
      const c = ck[ids[i]], km = num(stops[i].km);
      if (c && c.arriveSoc != null && from && km != null) {
        const dist = km - from.km, used = from.soc - c.arriveSoc;
        const kpp = used > 0 ? dist / used : null;
        const ok = dist > 0 && used > 0 && kpp >= SANE_MIN && kpp <= SANE_MAX;
        segs.push({ fromIdx: from.i, toIdx: i, km: dist, used, kmPerPct: kpp, ok });
      }
      // 打了卡却没记离站电量（到了没按「出发」）：不知道充了多少，下一段接不上，断开
      if (c) from = c.leaveSoc != null && km != null ? { i, soc: c.leaveSoc, km } : null;
      // 没打卡的站（跳过了）：from 不动，这一段跨过它量。要是其实在那儿充了电，用掉的 % 会变小或变负 → 上面的离谱线拦住；
      // 拦不住的（充得少、看着像省电）也只会让实测偏大，而实测只在比计划小的时候才被用上，所以落在保守一侧。
    }
    const last = segs.length ? segs[segs.length - 1] : null;
    return { segments: segs, last, measured: last && last.ok ? last.kmPerPct : null, bad: !!(last && !last.ok) };
  }

  // 睡觉站睡觉（露营模式开空调）耗的电 %。先睡后充：到站电量先扣掉它，睡醒才开始充。
  // 只认 type=sleep 的站 —— 跟 工具/排计划.py 一致（它也只在睡觉站扣）。
  function sleepPct(s) {
    const v = num(s && s.sleepUsePct);
    return s && s.type === 'sleep' && v > 0 ? v : 0;
  }

  // 每个能充电的站（和出发站）：「至少充到 X%」= 到下一个能充电的站（没有就到终点）要用的 % + 路上睡觉耗的 % + 保留电量，向上取整，最多 100；
  // 「按这个电量到下一站剩约 Y%」：这个电量 = 实际充到的（打了「出发」卡）> 计划充到的 > 计划离站电量。
  // ★ 睡觉耗的电两处都要算：途中不充电的睡觉站（sleepMid），和下一个充电站本身是睡觉站（sleepEnd：先睡后充，
  //   睡醒那一刻也得还剩保留电量 —— 桩坏了才开得到别处）。跟 排计划.py 定「充到多少」的算法一致（它加的是 nxt.sleepUsePct）。
  //   usePct 只放开车用的电：界面拿它说「开到哪儿要用约多少」，睡觉的另外说。
  function needs(plan, ck, ids, measured) {
    const stops = plan.stops, n = stops.length, out = {};
    const reserve = num(plan.car && plan.car.reservePct) != null ? plan.car.reservePct : 0;
    for (let i = 0; i < n - 1; i++) {
      const s = stops[i];
      if (!(isCharging(s) || s.type === 'start')) continue;
      let j = i + 1;
      while (j < n - 1 && !isCharging(stops[j])) j++;
      const use = usePct(plan, i, j, measured);
      if (use == null) continue;
      let sleepMid = 0;
      for (let m = i + 1; m < j; m++) sleepMid += sleepPct(stops[m]);
      const sleepEnd = sleepPct(stops[j]), sleep = sleepMid + sleepEnd;
      const c = ck[ids[i]] || {};
      const basisActual = c.leaveSoc != null;
      let basis = basisActual ? c.leaveSoc : num(s.chargeTo);
      if (basis == null) basis = num(s.socLeave);
      if (basis == null && s.type === 'start') basis = num(plan.startSoc);
      const raw = use + sleep + reserve;
      out[ids[i]] = {
        toIdx: j, toId: ids[j], toName: stops[j].name || '',
        km: num(stops[j].km) - num(s.km), usePct: use, sleepPct: sleep, sleepEnd, reserve,
        minPct: Math.min(100, Math.ceil(raw - EPS)),
        capped: raw > 100 + EPS,                       // 充满也不够留保留电量：中途得多充一次
        basis, basisActual,
        // 开到下一个充电站时剩多少（途中睡过觉的已扣掉；在那一站睡觉的还没扣）
        arrivePct: basis == null ? null : Math.floor(basis - use - sleepMid + EPS),
        // 下一个充电站是睡觉站：在那儿睡一觉以后、开始充电之前剩多少
        afterSleepPct: basis == null || !sleepEnd ? null : Math.floor(basis - use - sleep + EPS),
        short: basis == null ? false : basis - use - sleep < reserve - EPS,
      };
    }
    return out;
  }

  // ---------------- 总账 ----------------

  // plan：window.PLAN；rawCk：打卡记录；now：现在的毫秒数
  function compute(plan0, rawCk, now) {
    const stops = plan0 && Array.isArray(plan0.stops) ? plan0.stops.map(s => (s && typeof s === 'object' ? s : {})) : [];
    const plan = Object.assign({}, plan0 || {}, { stops });   // 缺 stops、某一站是 null 也照样算得动
    const n = stops.length;
    const ids = stops.map(stopId);
    const ck = cleanCheckins(rawCk);
    // ★ 10/5 回程判例：免费时段在出发前就开始了（exitNotBefore 早于计划出发），就没有「等 0 点」这回事。
    //   不这么判，回程页顶上会一直挂着去程那条「已过 0 点，可以出站」，看着像还要管出站时间。
    const exit0 = ms(plan && plan.exitNotBefore), dep0 = n ? (ms(stops[0].leave) != null ? ms(stops[0].leave) : ms(stops[0].arrive)) : null;
    const exitAt = exit0 != null && dep0 != null && exit0 <= dep0 ? null : exit0;
    const seen = {}, dupIds = [];
    ids.forEach(id => { if (seen[id] && dupIds.indexOf(id) < 0) dupIds.push(id); seen[id] = 1; });

    // ① 锚点 = 走得最远的那次打卡（同一站「出发」比「我到了」新）
    let k = -1;
    for (let i = n - 1; i >= 0; i--) if (ck[ids[i]]) { k = i; break; }
    let anchor = null, d = 0;
    if (k >= 0) {
      const c = ck[ids[k]], s = stops[k];
      const kind = c.leaveAt != null ? 'leave' : 'arrive';
      const at = kind === 'leave' ? c.leaveAt : c.arriveAt;
      let planned = kind === 'leave' ? ms(s.leave) : ms(s.arrive);
      if (planned == null) planned = kind === 'leave' ? ms(s.arrive) : ms(s.leave);
      d = planned == null ? 0 : at - planned;
      anchor = { idx: k, id: ids[k], kind, at, planned, delta: d };
    }

    // ② 进度：在哪一站、下一站是谁
    let cur = 0, atStop = false, done = false;
    if (k >= 0) {
      const c = ck[ids[k]], mode = checkMode(stops[k]);
      if (mode === 'both' && c.leaveAt == null) { cur = k; atStop = true; }
      else if (k === n - 1) { cur = k; atStop = true; done = true; }
      else cur = k + 1;
    }

    // ③ 时间：打过卡的用实际；锚点往后 = 原计划 + 平移（锚点的实际 − 锚点的计划）。
    //    ★ 等 0 点的站（type=wait）吸收提前量：早到就等到它的计划离开时刻，晚到就到了就走；
    //      后面的站按它「实际能走的时刻」再平移。不这样的话，早到 1 小时会把出站时间也算早 1 小时（早于 0 点 = 高速费不免）。
    const rows = [];
    for (let i = 0; i < n; i++) {
      const s = stops[i], c = ck[ids[i]] || null;
      const pa = ms(s.arrive), pl = ms(s.leave);
      let a, l;
      if (i < k) {
        a = c && c.arriveAt != null ? c.arriveAt : pa;
        l = c && c.leaveAt != null ? c.leaveAt : pl;
      } else {
        a = c && c.arriveAt != null ? c.arriveAt : (pa != null ? pa + d : null);
        if (c && c.leaveAt != null) l = c.leaveAt;
        else {
          l = pl != null ? pl + d : null;
          if (s.type === 'wait' && pl != null && a != null) l = Math.max(pl, a);
        }
        if (pl != null && l != null) d = l - pl;
      }
      let status;
      if (i === cur && !done) status = atStop ? 'here' : 'next';
      else if (i < cur || done) status = c ? 'done' : 'skipped';
      else status = 'todo';
      rows.push({
        idx: i, id: ids[i], stop: s, rec: c, status, mode: checkMode(s),
        arrive: a, leave: l, planArrive: pa, planLeave: pl,
        arriveActual: !!(c && c.arriveAt != null), leaveActual: !!(c && c.leaveAt != null),
      });
    }

    // ④ 能耗
    const m = measure(plan, ck, ids);
    // 正在开 / 马上要开的那一段（到第 legIdx 站）：人在站里、或者下一站是出发站 → 是往后那一段
    const legIdx = !n ? -1 : (atStop || rows[cur].mode === 'leave' ? cur + 1 : cur);
    const nextLeg = legIdx >= 1 && legIdx < n
      ? { idx: legIdx, plan: legPlan(plan, legIdx), eff: legEff(plan, legIdx, m.measured) } : null;
    const energy = {
      planKmPerPct: num(plan && plan.car && plan.car.kmPerPct),
      measured: m.measured, bad: m.bad, last: m.last, segments: m.segments, nextLeg,
    };

    // ⑤ 至少充到多少
    const need = n ? needs(plan, ck, ids, m.measured) : {};

    // ⑥ 下一站预计到站电量：只在上一站打了「出发」卡、记了电量时才算（没有就不显示，不拿计划数冒充）
    let projArrive = null;
    if (!done && !atStop && cur >= 1) {
      const pc = ck[ids[cur - 1]];
      const use = usePct(plan, cur - 1, cur, m.measured);
      if (pc && pc.leaveSoc != null && use != null) projArrive = Math.floor(pc.leaveSoc - use + EPS);
    }

    // ⑦ 0 点：等 0 点那一站（没有就看出收费站那一站）按平移后几点到
    let fi = stops.findIndex(s => s && s.type === 'wait'), fkind = 'wait';
    if (fi < 0) { fi = stops.findIndex(s => s && s.type === 'exit'); fkind = 'exit'; }
    let forecast = null;
    if (fi >= 0 && exitAt != null && rows[fi].arrive != null) {
      const r = rows[fi];
      forecast = { idx: fi, id: r.id, name: r.stop.name || '', kind: fkind, arrive: r.arrive,
        early: r.arrive < exitAt, waitMs: exitAt - r.arrive, reached: r.status === 'here' || r.status === 'done' || r.status === 'skipped' };
    }
    // 出站守卫：按现在推算，出收费站的时刻早于 0 点 → 界面要喊出来
    const xi = stops.findIndex(s => s && s.type === 'exit');
    const exitRow = xi >= 0 ? rows[xi] : null;
    const exitEarly = !!(exitRow && exitAt != null && exitRow.arrive != null && exitRow.arrive < exitAt);

    const lastKm = k >= 0 ? num(stops[k].km) : null;
    return {
      n, ids, ck, rows, anchor, cur, atStop, done, lastIdx: k,
      passedKm: lastKm != null ? lastKm : 0, totalKm: n ? num(stops[n - 1].km) : null,
      energy, needs: need, projArrive, forecast,
      exitAt, exitIdx: xi, exitEarly,
      countdown: exitAt == null ? null : { at: exitAt, left: exitAt - now, passed: now >= exitAt },
      dupIds,
    };
  }

  // ---------------- 显示用的格式（北京时间） ----------------
  const pad = x => (x < 10 ? '0' : '') + x;
  const bj = t => new Date(t + BJ);
  function fmtHM(t) { if (num(t) == null) return ''; const d = bj(t); return d.getUTCHours() + ':' + pad(d.getUTCMinutes()); }
  function fmtMD(t) { if (num(t) == null) return ''; const d = bj(t); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }
  function fmtWeek(t) { if (num(t) == null) return ''; return '周' + '日一二三四五六'[bj(t).getUTCDay()]; }
  function dayKey(t) { if (num(t) == null) return ''; const d = bj(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  // 「0 点」「0:30」：整点说「几点」，不是整点说时刻
  function fmtClockWord(t) { if (num(t) == null) return ''; const d = bj(t); return d.getUTCMinutes() ? fmtHM(t) : d.getUTCHours() + ' 点'; }
  function fmtDur(v) {
    if (num(v) == null) return '';
    const m = Math.round(Math.abs(v) / MIN), h = Math.floor(m / 60), mm = m % 60;
    if (h && mm) return h + ' 小时 ' + mm + ' 分';
    if (h) return h + ' 小时';
    return mm + ' 分';
  }
  function fmtShift(v) {
    if (num(v) == null) return '';
    if (Math.abs(v) < MIN) return '准点';
    return (v > 0 ? '晚 ' : '早 ') + fmtDur(v);
  }
  // <input type="datetime-local"> 用的「YYYY-MM-DDTHH:MM」，按北京时间写、按北京时间读
  function toInput(t) { const d = bj(t); return dayKey(t) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function fromInput(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00+08:00') : null;
  }
  // 高德导航链接：坐标是 gcj02（高德自己的坐标）就写 coordinate=gaode；写的是 wgs84 就照实告诉高德
  function amapUrl(nav) {
    if (!nav || num(nav.lat) == null || num(nav.lng) == null) return null;
    const coord = String(nav.coord || '').toLowerCase() === 'wgs84' ? 'wgs84' : 'gaode';
    return 'https://uri.amap.com/navigation?to=' + nav.lng + ',' + nav.lat + ',' + encodeURIComponent(nav.name || '')
      + '&mode=car&coordinate=' + coord + '&callnative=1';
  }

  return {
    SANE_MIN, SANE_MAX,
    ms, stopId, isCharging, checkMode, cleanCheckins,
    legPlan, legEff, usePct, sleepPct, measure, needs, compute,
    fmtHM, fmtMD, fmtWeek, dayKey, fmtClockWord, fmtDur, fmtShift, toInput, fromInput, amapUrl,
  };
});
