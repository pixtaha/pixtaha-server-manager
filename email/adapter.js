/* Pixtaha Management: payload v1 -> email view model.
   Pure functions, no dependencies. Runs in Node and in the n8n Code node. */
var PxReportAdapter = (function () {
  var TZ = 'Africa/Cairo';
  var SEV = { healthy: 'healthy', info: 'healthy', warning: 'warning', critical: 'critical', offline: 'offline', unknown: 'offline' };
  var RANK = { critical: 0, warning: 1, offline: 2, healthy: 3 };
  var LABEL = { critical: 'Critical', warning: 'Warning', offline: 'Offline', healthy: 'Healthy' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sev(s) { return SEV[s] || 'offline'; }
  function worst(list) { var w = 'healthy'; list.forEach(function (s) { if (RANK[s] < RANK[w]) w = s; }); return w; }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  function parts(iso) {
    var d = new Date(iso);
    var f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    var o = {}; f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function dateLong(iso) { var p = parts(iso); return p.weekday + ' ' + p.day + ' ' + p.month + ' ' + p.year; }
  function dateShort(iso) { var p = parts(iso); return p.weekday + ' ' + p.day + ' ' + p.month; }
  function dayMonth(iso) { var p = parts(iso); return p.day + ' ' + p.month; }
  function hhmm(iso) { if (!iso) return '—'; var p = parts(iso); return (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; }
  function whenShort(iso, refIso) {
    if (!iso) return 'never';
    var h = (new Date(refIso) - new Date(iso)) / 3600000;
    return h < 24 ? hhmm(iso) : dayMonth(iso);
  }
  function ago(iso, refIso) {
    if (!iso) return null;
    var h = Math.max(0, (new Date(refIso) - new Date(iso)) / 3600000);
    if (h < 1) return Math.round(h * 60) + 'm';
    if (h < 48) return Math.round(h) + 'h';
    return Math.round(h / 24) + 'd';
  }
  function mb(v) {
    if (v == null) return '—';
    if (v >= 1024) return (v / 1024).toFixed(v >= 10240 ? 0 : 1) + ' GB';
    return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' MB';
  }
  function gb1(vMb) { return (vMb / 1024).toFixed(1); }
  function dur(s) { if (s == null) return null; if (s < 60) return Math.round(s) + ' s'; var m = Math.floor(s / 60); return m + ' m ' + Math.round(s % 60) + ' s'; }
  function uptime(sec) { var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return d ? d + 'd ' + h + 'h' : h + 'h ' + Math.floor((sec % 3600) / 60) + 'm'; }

  function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  function toView(p, opt) {
    opt = opt || {};
    if (!p || p.schema_version !== '1.0') throw new Error('Unsupported payload: schema_version must be "1.0"');
    ['report', 'server', 'status', 'kpis'].forEach(function (k) { if (!p[k]) throw new Error('Payload is missing "' + k + '"'); });
    var rp = p.report, s = p.server, k = p.kpis, b = p.blocks || {};
    var ref = rp.generated_at;
    var status = sev(p.status.overall);
    var att = (p.attention || []).map(function (a) {
      return { sev: sev(a.severity), title: esc(a.title), impact: esc(a.impact || ''), action: esc(a.action || ''), _title: a.title };
    }).sort(function (x, y) { return RANK[x.sev] - RANK[y.sev]; });
    var nCrit = att.filter(function (a) { return a.sev === 'critical'; }).length;
    var nWarn = att.filter(function (a) { return a.sev === 'warning'; }).length;

    var v = {
      server: s.hostname,
      client: s.client,
      env: s.env,
      ip: s.public_ip || null,
      specs: [s.cores ? s.cores + ' cores' : null, s.ram_total_mb ? gb1(s.ram_total_mb) + ' GB RAM' : null, s.os || null].filter(Boolean).join(' · '),
      date: dateLong(ref),
      status: status,
      url: s.dashboard_url || opt.dashboardUrl || null,
      generated: hhmm(ref),
      agent: rp.collector_version ? 'v' + rp.collector_version : null,
      to: opt.to || 'contact@pixtaha.com',
      attention: att
    };

    // ---------- status line, note, subject, preheader
    var allRunning = !b.containers || b.containers.running === b.containers.total;
    if (status === 'offline') {
      v.statusLine = 'The collector did not report for this period.';
    } else if (status === 'critical') {
      v.statusLine = plural(nCrit, 'critical issue') + (nWarn ? ' and ' + plural(nWarn, 'warning') : '') + '.';
    } else if (att.length) {
      v.statusLine = plural(att.length, 'item') + ' need' + (att.length === 1 ? 's' : '') + ' attention.' + (allRunning ? ' Everything is running.' : '');
    } else {
      v.statusLine = 'All checks passed.';
    }
    if (p.note) v.note = p.note;
    else if (status === 'critical') v.note = 'Good morning. ' + s.hostname + ' is up, but ' + (nCrit === 1 ? 'one critical issue needs' : nCrit + ' critical issues need') + ' fixing today: ' + lowerFirst(att[0]._title) + '.' + (att.length > 1 ? ' ' + (att.length - 1 === 1 ? 'One smaller item follows.' : (att.length - 1) + ' smaller items follow.') : '');
    else if (att.length) v.note = 'Good morning. ' + s.hostname + ' ran normally overnight. ' + (att.length === 1 ? 'One item needs' : plural(att.length, 'item') + ' need') + ' your attention; the top one: ' + lowerFirst(att[0]._title) + '.';
    else v.note = 'Good morning. ' + s.hostname + ' had a quiet, healthy night. Nothing needs your attention today.';

    var n8nB = b.n8n && b.n8n.instances && b.n8n.instances.length ? b.n8n : null;
    v.subject = '[' + LABEL[status] + '] ' + s.hostname + ' · Daily report · ' + dateShort(ref);
    var pre = [];
    if (status === 'critical') pre.push(plural(nCrit, 'critical') + (nWarn ? ', ' + plural(nWarn, 'warning') : ''));
    else if (att.length) pre.push(plural(att.length, 'item') + ' need' + (att.length === 1 ? 's' : '') + ' attention');
    else pre.push('All checks passed');
    if (att.length && status === 'critical') pre.push(lowerFirst(att[0]._title));
    if (k.disk_used_pct != null) pre.push('disk ' + k.disk_used_pct + '%');
    if (n8nB) {
      var act = n8nB.instances.reduce(function (t, x) { return t + (x.workflows_active || 0); }, 0);
      pre.push(n8nB.instances.length > 5 ? n8nB.instances.length + ' n8n instances' : act + ' workflows active');
    }
    v.preheader = pre.join(' · ');

    // ---------- KPIs
    var hourly = (k.cpu_hourly_pct && k.cpu_hourly_pct.length) ? k.cpu_hourly_pct : [k.cpu_avg_pct || 0];
    var since = new Date(new Date(ref) - (s.uptime_seconds || 0) * 1000).toISOString();
    var diskTotalGb = s.disk_total_gb || 0;
    var diskUsedGb = k.disk_used_gb != null ? k.disk_used_gb : diskTotalGb * (k.disk_used_pct || 0) / 100;
    var days = k.disk_days_until_full;
    v.kpis = {
      uptime: { v: uptime(s.uptime_seconds || 0), s: 'Since ' + dayMonth(since), s2: (s.uptime_seconds || 0) < 86400 ? 'Rebooted in the last 24h' : 'No reboots in 24h' },
      cpu: { avg: Math.round(k.cpu_avg_pct || 0), peak: Math.round(k.cpu_peak_pct || 0), peakAt: hhmm(k.cpu_peak_at), spark: hourly.map(function (x) { return Math.round(x); }) },
      ram: { used: +(k.ram_used_mb / 1024).toFixed(1), total: +(s.ram_total_mb / 1024).toFixed(1) },
      disk: { pct: k.disk_used_pct, used: diskUsedGb.toFixed(1), total: diskTotalGb.toFixed(1), days: days == null ? '—' : (days > 365 ? '365+' : String(days)), sub: days == null ? 'No growth trend yet' : null }
    };

    // ---------- changes
    var KIND = { container_added: 'Added', container_removed: 'Removed', image_changed: 'Changed', port_opened: 'Opened', port_closed: 'Closed', config_changed: 'Changed', reboot: 'Reboot' };
    v.changes = (p.changes || []).map(function (c) {
      var t = c.text || (function () {
        switch (c.type) {
          case 'container_added': return 'Container ' + c.entity + ' created' + (c.to ? ' (' + c.to + ')' : '');
          case 'container_removed': return 'Container ' + c.entity + ' removed';
          case 'image_changed': return c.entity + ' image changed from ' + c.from + ' to ' + c.to;
          case 'port_opened': return 'Port ' + c.to + ' opened by ' + c.entity;
          case 'port_closed': return 'Port ' + c.from + ' closed (' + c.entity + ')';
          case 'reboot': return 'Server rebooted';
          default: return c.entity + ' configuration changed';
        }
      })();
      return { kind: KIND[c.type] || 'Changed', text: esc(t), time: hhmm(c.at) };
    });

    // ---------- containers
    if (b.containers) {
      var C = b.containers;
      var issues = (C.items || []).map(function (x) {
        if (sev(x.status) === 'healthy') return null;
        var list = [];
        if (x.oom_kills_24h) list.push(plural(x.oom_kills_24h, 'OOM kill'));
        if (x.restarts_24h) list.push('restarted ' + x.restarts_24h + '×');
        if (x.pinned === false) list.push('"latest"');
        if (x.mem_limit_mb == null) list.push('no memory limit');
        (x.ports || []).filter(function (pt) { return pt.public; }).forEach(function (pt) { list.push('Port ' + pt.port + ' published on ' + pt.bind); });
        if (x.issue) list = [x.issue];
        if (!list.length && sev(x.status) === 'healthy') return null;
        var sv = sev(x.status); if (sv === 'healthy') sv = x.oom_kills_24h ? 'critical' : 'warning';
        return { name: x.name, image: x.image + ':' + (x.tag || 'latest'), sev: sv, issue: esc(list.join(' · ')) };
      }).filter(Boolean).sort(function (a, z) { return RANK[a.sev] - RANK[z.sev]; });
      v.containers = { up: C.running, total: C.total, restarts: C.restarts_24h || 0, oom: C.oom_kills_24h || 0, latest: C.unpinned_images || 0, nolimit: C.missing_memory_limit || 0, issues: issues };
    }

    // ---------- n8n
    if (n8nB) {
      var inst = n8nB.instances.map(function (x) {
        var tg = x.telegram_webhooks || [], bad = tg.filter(function (t) { return !t.ok; }).length;
        var dbSev = (x.db_size_mb > 1024 || x.db_growth_mb_24h > 100) ? 'warning' : null;
        var note = x.note || [x.dead_host_nodes ? plural(x.dead_host_nodes, 'node') + ' call a dead host' : null, x.mem_limit_mb === null ? 'No memory limit' : null].filter(Boolean).join(' · ');
        return {
          name: x.container || x.name, version: x.version, sev: sev(x.status), pinned: x.pinned !== false,
          wf: (x.workflows_active || 0) + ' / ' + (x.workflows_total || 0),
          exec: num(x.executions_ok_24h) + ' ok · ' + num(x.executions_failed_24h) + ' failed', failed: x.executions_failed_24h || 0,
          db: (x.db_type === 'postgresdb' || x.db_type === 'postgres' ? 'Postgres ' : 'SQLite ') + mb(x.db_size_mb), dbSev: dbSev,
          tg: !tg.length ? 'Not set' : (bad ? (bad + ' mismatch') : plural(tg.length, 'bot') + ' OK'), tgSev: bad ? 'critical' : null,
          missed: x.schedules_missed_24h || 0, note: esc(note) || null
        };
      });
      if (inst.length > 5) {
        var bad2 = inst.filter(function (x) { return x.sev !== 'healthy'; });
        var okExec = n8nB.instances.reduce(function (t, x) { return t + (x.executions_ok_24h || 0); }, 0);
        v.n8n = { aggregate: { total: inst.length, healthy: inst.length - bad2.length, issues: bad2.length, exec: num(okExec) }, instances: bad2 };
      } else v.n8n = { instances: inst };
    }

    // ---------- scripts and services
    var svcRows = [];
    (b.services || []).forEach(function (x) {
      var kind = { systemd: 'systemd', model: 'model service', api: 'API', container: 'container' }[x.kind] || x.kind || 'service';
      var d = x.detail || [x.state === 'running' ? 'Running' : (x.state || 'Unknown'), x.user === 'root' ? 'runs as root' : null, x.port ? 'port ' + x.port + (x.public ? ' public' : ' local') : null, x.latency_ms != null ? 'latency ' + (x.latency_ms >= 1000 ? (x.latency_ms / 1000).toFixed(1) + ' s' : x.latency_ms + ' ms') : null].filter(Boolean).join(' · ');
      svcRows.push({ name: x.name, kind: kind, sev: sev(x.status), detail: esc(d) });
    });
    (b.scripts || []).forEach(function (x) {
      var d = x.detail || ['Last run ' + whenShort(x.last_run_at, ref), x.last_result === 'ok' ? 'success' : (x.last_result || 'unknown'), dur(x.duration_s)].filter(Boolean).join(' · ');
      svcRows.push({ name: x.name, kind: (x.kind || 'script') + (x.schedule ? ' · ' + x.schedule : ''), sev: sev(x.status), detail: esc(d) });
    });
    if (svcRows.length || b.systemd_units) {
      svcRows.sort(function (a, z) { return RANK[a.sev] - RANK[z.sev]; });
      v.services = { rows: svcRows, systemd: b.systemd_units || null };
    }

    // ---------- databases
    if (b.databases && b.databases.length) {
      v.databases = b.databases.map(function (d) {
        var age = ago(d.last_backup_at, ref);
        var h = d.last_backup_at ? (new Date(ref) - new Date(d.last_backup_at)) / 3600000 : null;
        return {
          name: d.name, engine: d.engine + (d.version ? ' ' + d.version : ''), sev: sev(d.status), size: mb(d.size_mb),
          growth: d.growth_mb_24h == null ? '—' : '+' + mb(d.growth_mb_24h), conn: d.connections == null ? '—' : d.connections + ' / ' + d.max_connections,
          backup: age ? age + ' ago' : 'Not found', backupSev: h == null ? 'warning' : (h > 168 ? 'critical' : (h > 48 ? 'warning' : null))
        };
      });
    }

    // ---------- domains
    if (b.domains && b.domains.length) {
      v.domains = b.domains.map(function (d) {
        var sv = !d.resolves_ok || !d.https_ok || d.cert_days_left <= 7 || d.renewal_ok === false ? 'critical' : (d.cert_days_left <= 21 ? 'warning' : 'healthy');
        return { domain: d.domain, ip: d.resolves_to || '—', resolves: !!d.resolves_ok, https: !!d.https_ok, days: d.cert_days_left == null ? '—' : d.cert_days_left, sev: sv };
      });
    }

    // ---------- security
    if (b.security) {
      var S = b.security, rows = [];
      rows.push(['SSH password login', S.ssh_password_auth ? 'Enabled' : 'Disabled', S.ssh_password_auth ? 'critical' : null]);
      var root = { 'no': 'Disabled', 'prohibit-password': 'Key only', 'without-password': 'Key only', 'yes': 'Password allowed' }[S.ssh_root_login] || (S.ssh_root_login || 'Unknown');
      rows.push(['Root login', root, S.ssh_root_login === 'yes' ? 'warning' : null]);
      if (S.failed_logins_24h != null) rows.push(['Failed logins 24h', num(S.failed_logins_24h) + (S.ssh_password_auth ? '' : ' (blocked by key auth)'), null]);
      rows.push(['Firewall', S.firewall_active ? 'Active' : 'Inactive', S.firewall_active ? null : 'warning']);
      rows.push(['Unknown login IPs', S.unknown_login_ips && S.unknown_login_ips.length ? S.unknown_login_ips.length + ' new' : 'None', S.unknown_login_ips && S.unknown_login_ips.length ? 'warning' : null]);
      if (S.tmp_executables) rows.push(['Executables in /tmp', String(S.tmp_executables), 'critical']);
      if (S.pending_security_updates != null) rows.push(['Security updates pending', String(S.pending_security_updates), S.pending_security_updates > 10 ? 'warning' : null]);
      if (S.reboot_required) rows.push(['Reboot required', 'Yes', 'warning']);
      var bad = rows.filter(function (r) { return r[2]; });
      var cs = bad.filter(function (r) { return r[2] === 'critical'; }).length, ws = bad.length - cs;
      v.security = {
        summary: [cs ? plural(cs, 'critical') : null, ws ? plural(ws, 'warning') : null].filter(Boolean).join(', '),
        rows: rows.map(function (r) { return [r[0], esc(r[1]), r[2]]; }),
        ports: (S.public_ports || []).map(function (pt) { return { port: pt.port, svc: pt.owner || '', db: !!pt.is_database }; })
      };
    }

    // ---------- backups
    if (b.backups && b.backups.length) {
      v.backups = b.backups.map(function (x) {
        return { name: x.name, last: whenShort(x.last_at, ref), age: ago(x.last_at, ref) || '—', size: mb(x.size_mb), sev: sev(x.status) };
      });
    }

    // ---------- compact "all good" layout
    var anyIssue = att.length || (v.n8n && v.n8n.instances.some(function (x) { return x.sev !== 'healthy'; }));
    if (status === 'healthy' && !anyIssue && !opt.full) {
      var compact = [];
      if (v.containers) compact.push(['Containers', v.containers.up + ' / ' + v.containers.total + ' up']);
      if (n8nB) compact.push(['n8n', plural(n8nB.instances.length, 'instance') + ' · ' + num(n8nB.instances.reduce(function (t, x) { return t + (x.executions_ok_24h || 0); }, 0)) + ' executions ok']);
      if (v.services && v.services.rows.length) compact.push(['Scripts and services', plural(v.services.rows.length, 'item') + ' running']);
      if (v.databases) compact.push(['Databases', v.databases.map(function (d) { return d.engine.split(' ')[0]; }).join(', ') + ' · backup ' + v.databases[0].backup]);
      if (v.domains) compact.push(['Domains and TLS', plural(v.domains.length, 'domain') + ' · ' + Math.min.apply(null, v.domains.map(function (d) { return +d.days || 999; })) + ' days left']);
      if (b.security) compact.push(['Security', (b.security.firewall_active ? 'Firewall on' : 'Firewall off') + ' · ' + (b.security.ssh_password_auth ? 'password SSH' : 'key-only SSH')]);
      if (v.backups) compact.push(['Backups', 'Last ' + v.backups[0].last + ' · ' + v.backups[0].size]);
      v.compact = compact.map(function (c) { return [c[0], esc(c[1]), 'healthy']; });
    }
    return v;
  }

  return { toView: toView, worst: worst };
})();
