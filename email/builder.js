/* Pixtaha Management daily server report email builder.
   Source: Claude Design export (Pixtaha Design System), adapted to render from payload v1.
   Table-based, inline-styled HTML for Gmail / Outlook / Apple Mail. No JS, no web fonts, no images. */
var PxReportEmail = (function () {
  var F = "'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  var M = "'IBM Plex Mono',Menlo,Consolas,'Courier New',monospace";
  var PAL = {
    light: { page:'#F3EDE6', card:'#FFFFFF', sunken:'#FAF6F1', border:'#E8E0D7', strong:'#D6CABE', text:'#1A1411', muted:'#5F544C', subtle:'#7A6D64', primary:'#B8522F', onPrimary:'#FFFFFF', brand:'#C65D3B',
      critical:'#B42318', criticalSoft:'#FBEAE8', warning:'#8F5B00', warningSoft:'#F8EED9', healthy:'#2F7D4F', healthySoft:'#E7F2EA', offline:'#5F544C', offlineSoft:'#F3EDE6' },
    dark: { page:'#110E0C', card:'#1D1916', sunken:'#14110E', border:'#332B25', strong:'#4A3F37', text:'#F3ECE4', muted:'#B8AEA6', subtle:'#958A81', primary:'#E07A56', onPrimary:'#1A1411', brand:'#C65D3B',
      critical:'#F07065', criticalSoft:'#3A1F1B', warning:'#E2B254', warningSoft:'#352A16', healthy:'#4CC38A', healthySoft:'#17301F', offline:'#B8AEA6', offlineSoft:'#262019' }
  };
  var ST = { critical:{g:'&#9670;',l:'Critical'}, warning:{g:'&#9650;',l:'Warning'}, offline:{g:'&#9675;',l:'Offline'}, healthy:{g:'&#10003;',l:'Healthy'} };
  var ORDER = { critical:0, warning:1, offline:2, healthy:3 };

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function build(r, opt) {
    opt = opt || {};
    var P = PAL[opt.theme || 'light'];
    var END = opt.dir === 'rtl' ? 'left' : 'right', START = opt.dir === 'rtl' ? 'right' : 'left';
    var lr = 'mso-line-height-rule:exactly;';
    function ltr(s){ return '<span dir="ltr" style="unicode-bidi:isolate">'+s+'</span>'; }
    function mono(s, c){ return '<span dir="ltr" style="font-family:'+M+';font-size:13px;color:'+(c||P.text)+'">'+esc(s)+'</span>'; }
    function badge(s, txt){ var m=ST[s]; return '<span style="display:inline-block;padding:3px 10px 3px 8px;border-radius:999px;background:'+P[s+'Soft']+';color:'+P[s]+';font-family:'+F+';font-size:12px;line-height:16px;font-weight:600;white-space:nowrap"><span style="font-size:10px">'+m.g+'</span>&nbsp;'+(txt||m.l)+'</span>'; }
    function mark(s){ var m=ST[s]; return '<span style="color:'+P[s]+';font-weight:600;white-space:nowrap"><span style="font-size:10px">'+m.g+'</span>&nbsp;'+m.l+'</span>'; }
    function bar(pct, c){ pct=Math.max(1,Math.min(99,pct)); return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="'+pct+'%" style="background:'+c+';height:4px;font-size:0;line-height:0;border-radius:2px">&nbsp;</td><td style="background:'+P.border+';height:4px;font-size:0;line-height:0">&nbsp;</td></tr></table>'; }
    function spark(vals, peakIdx){ var h='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" height="22"><tr>'; for(var i=0;i<vals.length;i++){ var v=Math.max(2,Math.round(vals[i]*22/100)); h+='<td valign="bottom" style="padding:0 1px 0 0;height:22px"><div style="height:'+v+'px;background:'+(i===peakIdx?P.primary:P.strong)+';font-size:0;line-height:0">&nbsp;</div></td>'; } return h+'</tr></table>'; }
    function p(txt, style){ return '<p style="margin:0;font-family:'+F+';'+lr+(style||'')+'">'+txt+'</p>'; }
    function sec(title, right, inner){
      return '<tr><td class="px bd" style="padding:28px 32px 4px;border-top:1px solid '+P.border+'">'+
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'+
        '<td align="'+START+'" style="font-family:'+F+';font-size:17px;line-height:24px;'+lr+'font-weight:500;color:'+P.text+'" class="tx">'+title+'</td>'+
        '<td align="'+END+'" style="font-family:'+F+';font-size:13px;line-height:20px;color:'+P.muted+'" class="mu">'+(right||'')+'</td></tr></table>'+
        '<div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>'+inner+'</td></tr>';
    }
    function rows(list){ // [label, value, extra]
      var h='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">';
      list.forEach(function(x,i){ h+='<tr><td align="'+START+'" valign="top" style="padding:10px 0;'+(i?'border-top:1px solid '+P.border+';':'')+'font-family:'+F+';font-size:14px;line-height:20px;color:'+P.muted+'" class="mu bd">'+x[0]+'</td><td align="'+END+'" valign="top" style="padding:10px 0;'+(i?'border-top:1px solid '+P.border+';':'')+'font-family:'+F+';font-size:14px;line-height:20px;color:'+P.text+'" class="tx bd">'+x[1]+'</td></tr>'; });
      return h+'</table>';
    }
    function kv(items, cls){ // tiles of label/value in 3 columns, 2 on mobile
      var h='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>';
      items.forEach(function(it,i){ if(i&&i%3===0) h+='</tr><tr>'; h+='<td class="kv" width="33%" valign="top" style="padding:8px 8px 8px 0;font-family:'+F+'"><div style="font-size:12px;line-height:16px;color:'+P.subtle+'">'+it[0]+'</div><div style="font-size:14px;line-height:20px;color:'+(it[2]?P[it[2]]:P.text)+';'+(it[2]?'font-weight:600;':'')+'">'+it[1]+'</div></td>'; });
      var pad=(3-items.length%3)%3; for(var k=0;k<pad;k++) h+='<td class="kv" width="33%">&nbsp;</td>';
      return h+'</tr></table>';
    }
    function item(head, body, first){ return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:14px 0;'+(first?'':'border-top:1px solid '+P.border+';')+'" class="bd">'+head+body+'</td></tr></table>'; }
    function statline(cells){ // compact figures row
      var h='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'+P.sunken+';border-radius:12px"><tr>';
      cells.forEach(function(c){ h+='<td class="kv" valign="top" style="padding:12px 14px;font-family:'+F+'"><div style="font-size:18px;line-height:24px;color:'+(c[2]?P[c[2]]:P.text)+';'+(c[2]?'font-weight:600;':'')+'">'+ltr(c[0])+'</div><div style="font-size:12px;line-height:16px;color:'+P.muted+'">'+c[1]+'</div></td>'; });
      return h+'</tr></table>';
    }
    var sCount = function(list){ var w=list.filter(function(x){return x.sev&&x.sev!=='healthy';}).length; return w? w+' need'+(w===1?'s':'')+' attention' : mark('healthy'); };

    var out = [];
    // ---------- header
    var st = ST[r.status];
    out.push('<tr><td class="px" style="padding:28px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'+
      '<td align="'+START+'" dir="ltr" style="font-family:'+F+';font-size:17px;line-height:24px;font-weight:500;color:'+P.text+';letter-spacing:-0.01em" class="tx">Pixtaha<span style="color:'+P.brand+'">.</span> <span style="font-weight:400;color:'+P.muted+'">Management</span></td>'+
      '<td align="'+END+'" style="font-family:'+F+';font-size:13px;line-height:20px;color:'+P.muted+'" class="mu">'+esc(r.date)+'</td></tr></table></td></tr>');
    out.push('<tr><td class="px" style="padding:32px 32px 28px">'+
      p('DAILY SERVER REPORT','font-family:'+M+';font-size:12px;line-height:16px;letter-spacing:0.08em;color:'+P.subtle)+
      '<div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>'+
      p(ltr(esc(r.server)),'font-size:32px;line-height:38px;font-weight:400;letter-spacing:-0.025em;color:'+P.text)+
      '<div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>'+
      p(esc(r.client)+' &nbsp;&middot;&nbsp; <span style="display:inline-block;padding:1px 8px;border:1px solid '+P.strong+';border-radius:999px;font-size:12px;line-height:18px;color:'+P.muted+'">'+esc(r.env)+'</span>'+(r.ip?' &nbsp;&middot;&nbsp; '+mono(r.ip,P.muted):''),'font-size:14px;line-height:22px;color:'+P.muted)+
      (r.specs?'<div style="height:4px;line-height:4px;font-size:0">&nbsp;</div>'+p(esc(r.specs),'font-size:13px;line-height:20px;color:'+P.subtle):'')+
      '</td></tr>');
    // status banner
    out.push('<tr><td class="px" style="padding:0 32px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'+P[r.status+'Soft']+';border-radius:12px"><tr>'+
      '<td width="36" valign="middle" style="padding:14px 0 14px 16px;font-family:'+F+';font-size:16px;line-height:20px;color:'+P[r.status]+'">'+st.g+'</td>'+
      '<td valign="middle" style="padding:14px 16px 14px 4px;font-family:'+F+';font-size:15px;line-height:22px;color:'+P.text+'"><strong style="color:'+P[r.status]+';font-weight:600">'+st.l+'</strong> &nbsp;'+esc(r.statusLine)+'</td></tr></table></td></tr>');
    // manager note
    out.push('<tr><td class="px" style="padding:0 32px 28px">'+p(esc(r.note),'font-size:16px;line-height:26px;color:'+P.text)+
      '<div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>'+p('Your server manager, Pixtaha Management','font-size:13px;line-height:20px;color:'+P.subtle)+'</td></tr>');
    // KPIs
    var k=r.kpis, cpuPeak=k.cpu.spark.indexOf(Math.max.apply(null,k.cpu.spark));
    var ramPct=Math.round(k.ram.used/k.ram.total*100);
    function tile(label, val, sub, viz){ return '<td class="kpi" width="25%" valign="top" style="padding:0 4px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid '+P.border+';border-radius:12px;background:'+P.card+'"><tr><td style="padding:14px 14px 14px;font-family:'+F+'">'+
      '<div style="font-size:12px;line-height:16px;color:'+P.muted+'">'+label+'</div><div style="height:6px;line-height:6px;font-size:0">&nbsp;</div>'+
      '<div style="font-size:20px;line-height:26px;color:'+P.text+';letter-spacing:-0.01em">'+val+'</div>'+
      '<div style="font-size:12px;line-height:16px;color:'+P.muted+';padding-bottom:10px">'+sub+'</div>'+viz+'</td></tr></table></td>'; }
    out.push('<tr><td class="px kpiwrap" style="padding:0 28px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'+
      tile('Uptime', ltr(esc(k.uptime.v)), esc(k.uptime.s)+'<br>'+esc(k.uptime.s2||'No reboots in 24h'), '')+
      tile('CPU 24h', ltr(k.cpu.avg+'%')+' <span style="font-size:13px;color:'+P.muted+'">avg</span>', 'Peak '+ltr(k.cpu.peak+'%')+'<br>at '+ltr(k.cpu.peakAt), spark(k.cpu.spark, cpuPeak))+
      tile('RAM', ltr(k.ram.used+' <span style="font-size:13px;color:'+P.muted+'">/ '+k.ram.total+' GB</span>'), ramPct+'% used<br>&nbsp;', bar(ramPct, ramPct>85?P.warning:P.strong))+
      tile('Disk', ltr(k.disk.pct+'%'), ltr(k.disk.used+' / '+k.disk.total+' GB')+'<br>'+(k.disk.sub?esc(k.disk.sub):'Full in '+ltr(esc(k.disk.days))+' days'), bar(k.disk.pct, k.disk.pct>85?P.warning:P.strong))+
      '</tr></table></td></tr>');

    // needs attention
    var att=(r.attention||[]).slice().sort(function(a,b){return ORDER[a.sev]-ORDER[b.sev];});
    var attInner='';
    if(!att.length){
      attInner='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'+P.sunken+';border-radius:12px"><tr><td style="padding:20px;font-family:'+F+';font-size:15px;line-height:22px;color:'+P.text+'"><span style="color:'+P.healthy+';font-weight:600">&#10003;</span>&nbsp; Nothing needs your attention today.</td></tr></table>';
    } else att.forEach(function(a,i){
      attInner+=item(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="30" valign="top" style="font-family:'+M+';font-size:12px;line-height:22px;color:'+P.subtle+'">'+(i<9?'0':'')+(i+1)+'</td><td valign="top" style="font-family:'+F+';font-size:15px;line-height:22px;font-weight:500;color:'+P.text+'">'+a.title+'</td><td align="'+END+'" valign="top" width="96" style="padding-'+START+':8px">'+badge(a.sev)+'</td></tr>'+
        '<tr><td></td><td colspan="2" style="padding-top:4px;font-family:'+F+';font-size:14px;line-height:21px;color:'+P.muted+'">'+a.impact+'</td></tr>'+
        '<tr><td></td><td colspan="2" style="padding-top:6px;font-family:'+F+';font-size:14px;line-height:21px;color:'+P.text+'"><span style="color:'+P.subtle+'">Do:</span> '+a.action+'</td></tr></table>','',i===0);
    });
    out.push(sec('Needs attention', att.length? att.length+' item'+(att.length>1?'s':'')+', most severe first':'', attInner));

    if(r.compact){
      out.push(sec('All checks', mark('healthy'), rows(r.compact.map(function(c){return [c[0], c[1]+' &nbsp;'+mark(c[2]||'healthy')];}))));
    } else {
      // changes
      if(r.changes){
        var ch=r.changes.length? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'+r.changes.map(function(c,i){
          return '<tr><td width="88" valign="top" style="padding:10px 0;'+(i?'border-top:1px solid '+P.border+';':'')+'"><span style="display:inline-block;padding:1px 8px;border:1px solid '+P.strong+';border-radius:999px;font-family:'+M+';font-size:11px;line-height:18px;color:'+P.muted+';text-transform:uppercase;letter-spacing:0.04em">'+c.kind+'</span></td><td valign="top" style="padding:10px 0;'+(i?'border-top:1px solid '+P.border+';':'')+'font-family:'+F+';font-size:14px;line-height:21px;color:'+P.text+'">'+c.text+'</td><td align="'+END+'" valign="top" width="52" style="padding:10px 0;'+(i?'border-top:1px solid '+P.border+';':'')+'font-family:'+M+';font-size:12px;line-height:21px;color:'+P.subtle+'">'+c.time+'</td></tr>';}).join('')+'</table>'
          : p('No changes since yesterday.','font-size:14px;line-height:21px;color:'+P.muted);
        out.push(sec('Changes since yesterday', r.changes.length? r.changes.length+' change'+(r.changes.length>1?'s':''):'', ch));
      }
      // containers
      if(r.containers){
        var c=r.containers;
        var ci=statline([[c.up+'/'+c.total,'Up',c.up<c.total?'warning':null],[String(c.restarts),'Restarts 24h',c.restarts?'warning':null],[String(c.oom),'OOM kills',c.oom?'critical':null],[String(c.latest),'On "latest"',c.latest?'warning':null],[String(c.nolimit),'No mem limit']]);
        if(c.issues&&c.issues.length){
          ci+='<div style="height:8px;line-height:8px;font-size:0">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'+
            c.issues.map(function(x,i){ return '<tr><td valign="top" style="padding:12px 12px 12px 0;border-top:1px solid '+P.border+';font-family:'+F+'"><div style="font-size:14px;line-height:20px;color:'+P.text+'">'+ltr(esc(x.name))+'</div><div style="font-family:'+M+';font-size:12px;line-height:18px;color:'+P.subtle+'" dir="ltr">'+esc(x.image)+'</div></td><td valign="top" width="52%" style="padding:12px 0;border-top:1px solid '+P.border+';font-family:'+F+';font-size:13px;line-height:20px;color:'+P.muted+'">'+mark(x.sev)+'<br>'+x.issue+'</td></tr>'; }).join('')+'</table>';
        }
        out.push(sec('Containers', c.issues&&c.issues.length? c.issues.length+' with issues':mark('healthy'), ci));
      }
      // n8n
      if(r.n8n){
        var n=r.n8n, ni='';
        function inst(x,first){ return item('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:'+F+';font-size:15px;line-height:22px;font-weight:500;color:'+P.text+'">'+ltr(esc(x.name))+' <span style="font-family:'+M+';font-size:12px;font-weight:400;color:'+P.subtle+'">'+esc(x.version)+'</span></td><td align="'+END+'">'+badge(x.sev)+'</td></tr></table>',
          '<div style="height:4px;line-height:4px;font-size:0">&nbsp;</div>'+kv([['Workflows active',ltr(x.wf)],['Executions 24h',ltr(x.exec), x.failed?'warning':null],['Database',ltr(esc(x.db)), x.dbSev||null],['Telegram webhook',x.tg, x.tgSev||null],['Missed schedules',ltr(String(x.missed)), x.missed?'warning':null],['Image',x.pinned?'Pinned':'"latest"', x.pinned?null:'warning']])+(x.note?p(x.note,'padding-top:6px;font-size:13px;line-height:20px;color:'+P.muted):''), first); }
        if(n.aggregate){
          var a=n.aggregate;
          ni+=statline([[String(a.total),'Instances'],[String(a.healthy),'Healthy'],[String(a.issues),'With issues',a.issues?'warning':null],[a.exec,'Executions 24h']]);
          ni+='<div style="height:8px;line-height:8px;font-size:0">&nbsp;</div>';
          n.instances.forEach(function(x,i){ ni+=inst(x,false); });
          ni+='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:14px 0;border-top:1px solid '+P.border+';font-family:'+F+';font-size:14px;line-height:20px;color:'+P.muted+'">'+a.healthy+' healthy instances hidden'+(r.url?' &nbsp;&middot;&nbsp; <a href="'+r.url+'#n8n" style="color:'+P.primary+';text-decoration:none;font-weight:500">View all in dashboard</a>':'')+'</td></tr></table>';
        } else n.instances.forEach(function(x,i){ ni+=inst(x,i===0); });
        out.push(sec('n8n', n.aggregate? n.aggregate.total+' instances &middot; '+n.aggregate.healthy+' healthy &middot; '+n.aggregate.issues+' with issues' : n.instances.length+' instance'+(n.instances.length>1?'s':''), ni));
      }
      // scripts & services
      if(r.services){
        var s=r.services;
        var si=s.rows.map(function(x,i){ return item('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:'+F+';font-size:15px;line-height:22px;font-weight:500;color:'+P.text+'">'+ltr(esc(x.name))+' <span style="font-weight:400;font-size:12px;color:'+P.subtle+'">'+esc(x.kind)+'</span></td><td align="'+END+'" style="font-family:'+F+';font-size:13px">'+mark(x.sev)+'</td></tr></table>',
          p(x.detail,'padding-top:4px;font-size:13px;line-height:20px;color:'+P.muted), i===0); }).join('');
        if(s.systemd) si+='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 0;border-top:1px solid '+P.border+';font-family:'+F+';font-size:14px;line-height:20px;color:'+P.muted+'">systemd units</td><td align="'+END+'" style="padding:12px 0;border-top:1px solid '+P.border+';font-family:'+F+';font-size:14px;color:'+P.text+'">'+ltr(s.systemd.running+' running &middot; '+s.systemd.failed+' failed')+'</td></tr></table>';
        out.push(sec('Scripts and services', sCount(s.rows), si));
      }
      if(r.databases){
        out.push(sec('Databases', sCount(r.databases), r.databases.map(function(d,i){ return item('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:'+F+';font-size:15px;line-height:22px;font-weight:500;color:'+P.text+'">'+esc(d.name)+' <span style="font-family:'+M+';font-size:12px;font-weight:400;color:'+P.subtle+'">'+esc(d.engine)+'</span></td><td align="'+END+'" style="font-family:'+F+';font-size:13px">'+mark(d.sev)+'</td></tr></table>',
          kv([['Size',ltr(d.size)],['Growth 24h',ltr(d.growth)],['Connections',ltr(d.conn)],['Last backup',d.backup,d.backupSev||null]]), i===0); }).join('')));
      }
      if(r.domains){
        out.push(sec('Domains and TLS', sCount(r.domains), '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'+r.domains.map(function(d,i){
          var b=(i?'border-top:1px solid '+P.border+';':'');
          return '<tr><td valign="top" style="padding:12px 0;'+b+'font-family:'+F+'"><div style="font-size:14px;line-height:20px;color:'+P.text+'">'+ltr(esc(d.domain))+'</div><div style="font-size:12px;line-height:18px;color:'+P.subtle+'">Resolves to '+mono(d.ip,P.subtle)+' '+(d.resolves?'(expected)':'<span style="color:'+P.warning+'">(unexpected)</span>')+' &middot; HTTPS '+(d.https?'OK':'failing')+'</div></td><td align="'+END+'" valign="top" style="padding:12px 0;'+b+'font-family:'+F+';font-size:13px;line-height:20px;color:'+P.muted+';white-space:nowrap">'+mark(d.sev)+'<br>'+ltr(d.days+' days')+'</td></tr>'; }).join('')+'</table>'));
      }
      if(r.security){
        var sc=r.security;
        var sr=rows(sc.rows.map(function(x){ return [x[0], (x[2]&&x[2]!=='healthy'? '<span style="color:'+P[x[2]]+';font-weight:600"><span style="font-size:10px">'+ST[x[2]].g+'</span>&nbsp;'+x[1]+'</span>' : x[1])]; }));
        sr+='<div style="padding:10px 0 4px;border-top:1px solid '+P.border+';font-family:'+F+';font-size:14px;line-height:20px;color:'+P.muted+'">Public ports</div><div style="padding-bottom:12px;line-height:30px">'+sc.ports.map(function(pt){
          return '<span style="display:inline-block;margin:0 4px 4px 0;padding:2px 10px;border-radius:999px;border:1px solid '+(pt.db?P.critical:P.strong)+';background:'+(pt.db?P.criticalSoft:P.card)+';font-family:'+M+';font-size:12px;line-height:20px;color:'+(pt.db?P.critical:P.text)+';white-space:nowrap" dir="ltr">'+pt.port+' <span style="font-family:'+F+';color:'+(pt.db?P.critical:P.subtle)+'">'+esc(pt.svc)+(pt.db?' &middot; database port':'')+'</span></span>'; }).join('')+'</div>';
        out.push(sec('Security', sc.summary, sr));
      }
      if(r.backups){
        out.push(sec('Backups', sCount(r.backups), rows(r.backups.map(function(b){ return [esc(b.name), ltr(esc(b.last))+' &middot; '+ltr(esc(b.age))+' ago &middot; '+ltr(esc(b.size))+' &nbsp;'+mark(b.sev)]; }))));
      }
    }
    // footer
    out.push('<tr><td class="px" style="padding:32px 32px 32px;border-top:1px solid '+P.border+'" align="center">'+
      (r.url?'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="'+P.primary+'" style="border-radius:999px;background:'+P.primary+'"><a href="'+r.url+'" style="display:block;padding:14px 28px;font-family:'+F+';font-size:15px;line-height:20px;font-weight:500;color:'+P.onPrimary+';text-decoration:none;border-radius:999px;white-space:nowrap">Open in dashboard</a></td></tr></table>'+
      '<div style="height:20px;line-height:20px;font-size:0">&nbsp;</div>':'')+
      p('Report generated '+ltr(r.generated)+' Cairo time (UTC+2) by collector '+ltr(esc(r.agent||'v0.1')),'font-size:12px;line-height:18px;color:'+P.subtle+';text-align:center')+
      p('Sent by Pixtaha Management to '+ltr(esc(r.to||'contact@pixtaha.com')),'font-size:12px;line-height:18px;color:'+P.subtle+';text-align:center')+'</td></tr>');

    var css='body{margin:0;padding:0;-webkit-text-size-adjust:100%}table{border-collapse:collapse}a{color:'+P.primary+'}'+
      '@media (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.kpiwrap{padding-left:16px!important;padding-right:16px!important}.kpi{display:inline-block!important;width:50%!important;box-sizing:border-box}.kv{display:inline-block!important;width:50%!important;box-sizing:border-box}.wrap{border-radius:0!important;border-left:0!important;border-right:0!important}.outer{padding:0!important}}'+
      (opt.theme==='dark'?'':'@media (prefers-color-scheme:dark){.pg{background:#110E0C!important}.wrap{background:#1D1916!important;border-color:#332B25!important}}');
    return '<!DOCTYPE html><html lang="en" dir="'+(opt.dir||'ltr')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>'+esc(r.subject)+'</title><style>'+css+'</style></head>'+
      '<body class="pg" style="margin:0;padding:0;background:'+P.page+'">'+
      '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:'+P.page+'">'+esc(r.preheader)+'&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>'+
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pg" style="background:'+P.page+'"><tr><td align="center" class="outer" style="padding:24px 12px">'+
      '<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->'+
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wrap" style="max-width:640px;background:'+P.card+';border:1px solid '+P.border+';border-radius:16px">'+out.join('')+'</table>'+
      '<!--[if mso]></td></tr></table><![endif]-->'+
      '</td></tr></table></body></html>';
  }
  return { build: build, palettes: PAL };
})();
