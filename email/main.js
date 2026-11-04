// Pixtaha Management | Build daily report email
// Library above is minified from the repo: email/builder.js + email/adapter.js (pixtaha/pixtaha-server-manager).
// Input: payload v1 in json.body, optional issue history in json.history (from server_manager.ingest_report).
// Output: one item per report with subject and html.
const RECIPIENT = 'contact@pixtaha.com';
const SENDER = 'Pixtaha Management <management@pixtaha.com>';

const out = [];
for (const item of $input.all()) {
  const payload = item.json.body;
  const view = PxReportAdapter.toView(payload, { to: RECIPIENT, history: item.json.history || null });
  const html = PxReportEmail.build(view, { theme: 'light' });
  out.push({
    json: {
      report_id: payload.report.id,
      server: payload.server.hostname,
      client: payload.server.client,
      env: payload.server.env,
      status: view.status,
      from: SENDER,
      to: RECIPIENT,
      subject: view.subject,
      preheader: view.preheader,
      html,
    },
  });
}
return out;
