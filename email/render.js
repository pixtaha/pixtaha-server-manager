// Usage: node email/render.js <payload.json> <out.html> [light|dark]
const fs = require('fs');
eval(fs.readFileSync(__dirname + '/builder.js', 'utf8') + fs.readFileSync(__dirname + '/adapter.js', 'utf8') + ';global.B=PxReportEmail;global.A=PxReportAdapter;');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const view = A.toView(payload, { to: 'contact@pixtaha.com' });
const html = B.build(view, { theme: process.argv[4] || 'light' });
fs.writeFileSync(process.argv[3], html);
console.log(JSON.stringify({ subject: view.subject, preheader: view.preheader, bytes: html.length }));
