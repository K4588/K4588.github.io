/*
 * 광명 데이터마일 키오스크 - 응답 기록기 (StanbyME lite)
 * - 체험 1건이 끝날 때마다 한 줄(row)을 만들어 기기에 먼저 보관하고
 * - 구글 스프레드시트(Apps Script 웹 앱)로 전송, 저장이 확인된 건만 대기 목록에서 지웁니다.
 * - 인터넷이 끊겨도 기록은 기기에 남아 있다가 다시 연결되면 자동 전송됩니다.
 * 구형 webOS 브라우저 호환을 위해 최신 문법을 쓰지 않았습니다.
 */
(function () {
  "use strict";
  var CFG = window.GM_RECORD_CONFIG || {};
  var KEY_QUEUE = "gm_rec_queue_v1";      // 아직 저장 확인이 안 된 기록
  var KEY_ARCHIVE = "gm_rec_archive_v1";  // 기기 보관본 (최근 순, 최대 MAX_ARCHIVE건)
  var KEY_STATS = "gm_rec_stats_v1";
  var KEY_KIOSK = "gm_kiosk_name";
  var MAX_QUEUE = 3000, MAX_ARCHIVE = 1500, BATCH = 40;
  var RETRY_MS = 60 * 1000;
  var PREFIX = { energy: "E", mobility: "M", safety: "S", data: "D" };
  var sending = false;

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(d) {
    d = d ? new Date(d) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function stats() { return load(KEY_STATS, { recorded: 0, confirmed: 0, lastSentAt: "", lastError: "", lastErrorAt: "" }); }
  function setStats(patch) { var s = stats(); for (var k in patch) s[k] = patch[k]; save(KEY_STATS, s); return s; }

  // 키오스크 이름: ?kiosk=이름 으로 한 번 열면 기기에 저장
  (function () {
    try {
      var m = /[?&]kiosk=([^&#]+)/.exec(location.search);
      if (m) localStorage.setItem(KEY_KIOSK, decodeURIComponent(m[1].replace(/\+/g, " ")));
    } catch (e) {}
  })();
  function kioskName() {
    var n = null;
    try { n = localStorage.getItem(KEY_KIOSK); } catch (e) {}
    return n || CFG.kioskName || "kiosk";
  }

  function toRow(p) {
    var d = p.demographics || {}, ch = p.choices || [];
    function q(i) { var c = ch[i]; return c ? (c.selectedLetter + " · " + (c.selectedLabel || "")) : ""; }
    var pre = PREFIX[p.focusMile] || "";
    return {
      id: String(p.id || ("dm_local_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))),
      deviceTime: fmt(p.createdAt),
      kiosk: kioskName(),
      age: d.age || "", job: d.job || "", region: d.region || "", knowledge: d.knowledge || "",
      focusMile: p.focusMileLabel || p.focusMile || "",
      q1: q(0), q2: q(1), q3: q(2), q4: q(3),
      code: (pre ? pre + "-" : "") + (p.citizenCode || ""),
      typeName: p.citizenTypeName || "",
      tags: (p.citizenTypeTags || []).join(", "),
      solution: p.citizenSolution || "",
      action: p.citizenAction || "",
      test: p.__test ? "테스트" : ""
    };
  }

  function enqueue(row) {
    var q = load(KEY_QUEUE, []);
    q.push(row);
    if (q.length > MAX_QUEUE) q = q.slice(q.length - MAX_QUEUE);
    if (!save(KEY_QUEUE, q)) { // 저장 공간 부족 시 보관본을 줄이고 재시도
      save(KEY_ARCHIVE, load(KEY_ARCHIVE, []).slice(-200));
      save(KEY_QUEUE, q);
    }
    var a = load(KEY_ARCHIVE, []);
    a.push(row);
    if (a.length > MAX_ARCHIVE) a = a.slice(a.length - MAX_ARCHIVE);
    save(KEY_ARCHIVE, a);
  }

  function post(rows, mode) {
    return fetch(CFG.endpoint, {
      method: "POST",
      mode: mode,
      credentials: "omit",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ rows: rows })
    });
  }

  function friendly(err) {
    var m = String(err && err.message || err);
    if (err && err.name === "SyntaxError") return "응답 형식 오류 - 웹 앱을 '모든 사용자' 액세스로 배포했는지, 주소가 /exec 로 끝나는지 확인해 주세요";
    if (/fetch|network|Load failed/i.test(m)) return "전송 실패 - 인터넷 연결, 웹 앱 주소(/exec로 끝나는지), 액세스 권한('모든 사용자')을 확인해 주세요";
    return m;
  }

  // 대기 중인 기록 전송. 서버가 저장을 확인한 id만 대기 목록에서 제거.
  function flush() {
    if (sending || !CFG.endpoint) return Promise.resolve({ skipped: true });
    var q = load(KEY_QUEUE, []);
    if (!q.length) return Promise.resolve({ sent: 0 });
    sending = true;
    var batch = q.slice(0, BATCH);
    return post(batch, "cors").then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data || data.ok !== true) throw new Error((data && data.error) || "서버 응답 오류");
      var ok = {};
      (data.saved || []).forEach(function (id) { ok[id] = true; });
      var rest = load(KEY_QUEUE, []).filter(function (r) { return !ok[r.id]; });
      save(KEY_QUEUE, rest);
      var s = stats();
      setStats({ confirmed: (s.confirmed || 0) + (data.added || 0), lastSentAt: fmt(), lastError: "" });
      sending = false;
      if (rest.length && (data.saved || []).length) return flush();
      return { sent: (data.saved || []).length, sheetRows: data.rows };
    }).catch(function (err) {
      sending = false;
      setStats({ lastError: friendly(err), lastErrorAt: fmt() });
      // 응답을 못 읽는 환경 대비: 처음 실패한 기록은 응답 없이도 한 번 보내 둠 (서버에서 중복은 걸러짐)
      var fresh = batch.filter(function (r) { return !r.__beaconed; });
      if (fresh.length) {
        try { post(fresh, "no-cors").catch(function () {}); } catch (e) {}
        var cur = load(KEY_QUEUE, []);
        var mark = {}; fresh.forEach(function (r) { mark[r.id] = true; });
        cur.forEach(function (r) { if (mark[r.id]) r.__beaconed = 1; });
        save(KEY_QUEUE, cur);
      }
      return { error: friendly(err) };
    });
  }

  // 앱에서 체험 1건 완료 시 호출됨
  window.__gmRecord = function (payload) {
    try {
      var row = toRow(payload || {});
      enqueue(row);
      var s = stats();
      setStats({ recorded: (s.recorded || 0) + 1 });
      setTimeout(flush, 300);
    } catch (e) { setStats({ lastError: "기록 생성 실패: " + e, lastErrorAt: fmt() }); }
  };

  window.__gmRecorder = {
    flush: flush,
    stats: stats,
    kioskName: kioskName,
    setKioskName: function (n) { try { localStorage.setItem(KEY_KIOSK, n); } catch (e) {} },
    pending: function () { return load(KEY_QUEUE, []).length; },
    archived: function () { return load(KEY_ARCHIVE, []).length; },
    resendArchive: function () {
      var a = load(KEY_ARCHIVE, []), q = load(KEY_QUEUE, []), have = {};
      q.forEach(function (r) { have[r.id] = true; });
      a.forEach(function (r) { if (!have[r.id]) { var c = {}; for (var k in r) if (k !== "__beaconed") c[k] = r[k]; q.push(c); } });
      save(KEY_QUEUE, q.slice(-MAX_QUEUE));
      return flush();
    },
    sendTest: function () {
      window.__gmRecord({ id: "test_" + Date.now().toString(36), __test: true, createdAt: new Date().toISOString(),
        demographics: { age: "-", job: "-", region: "-", knowledge: "-" }, focusMileLabel: "연결 테스트", citizenCode: "TEST" });
      return new Promise(function (r) { setTimeout(r, 400); }).then(flush);
    },
    sheetCount: function () {
      if (!CFG.endpoint) return Promise.reject(new Error("전송 주소 미설정"));
      return fetch(CFG.endpoint + (CFG.endpoint.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), { credentials: "omit" })
        .then(function (r) { return r.json(); });
    },
    config: CFG
  };

  setTimeout(flush, 4000);
  setInterval(flush, RETRY_MS);
  window.addEventListener("online", function () { setTimeout(flush, 1000); });
})();
