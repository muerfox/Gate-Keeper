const NAV = [
  { href: "/", label: "Overview" },
  { href: "/signup", label: "Normal verification" },
  { href: "/suspicious", label: "Bot simulation" },
  { href: "/accessible", label: "Accessibility mode" },
  { href: "/offline", label: "Offline mode" },
  { href: "/api-demo", label: "API verification" },
];

export function layout(title: string, body: string, activeHref = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Gate Keeper Demo</title>
<style>
  :root {
    --bg:#070c17; --surface:#0f1830; --surface-2:#141f3d; --border:#22304f;
    --text:#e6ecf7; --muted:#8a97b3; --accent:#3b82f6; --accent-hover:#5b93f8;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-size:15px; }
  header { display:flex; align-items:center; gap:24px; padding:16px 28px; border-bottom:1px solid var(--border); background:var(--surface); }
  header .brand { font-weight:700; display:flex; align-items:center; gap:8px; }
  nav { display:flex; gap:16px; flex-wrap:wrap; }
  nav a { color:var(--muted); text-decoration:none; font-size:13px; padding:4px 0; }
  nav a.active, nav a:hover { color:var(--text); border-bottom:2px solid var(--accent); }
  main { max-width:820px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:26px; margin-bottom:6px; }
  .subtitle { color:var(--muted); margin-top:0; margin-bottom:28px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; margin-bottom:20px; }
  a { color:var(--accent); }
  code, pre { background:var(--surface-2); border-radius:6px; }
  pre { padding:14px; overflow-x:auto; font-size:13px; }
  code { padding:2px 5px; font-size:13px; }
  .btn { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:10px 16px; font-weight:600; cursor:pointer; font-size:14px; }
  .btn:hover { background:var(--accent-hover); }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .result-box { font-family:monospace; font-size:12px; background:var(--surface-2); border-radius:8px; padding:12px; white-space:pre-wrap; word-break:break-all; margin-top:14px; min-height:20px; }
  .muted { color:var(--muted); }
  .tag { display:inline-block; background:var(--surface-2); border:1px solid var(--border); border-radius:999px; padding:2px 10px; font-size:11px; margin-right:6px; }
</style>
</head>
<body>
<header>
  <div class="brand">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="10" rx="2" stroke="#3b82f6" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#3b82f6" stroke-width="2"/></svg>
    Gate Keeper
  </div>
  <nav>
    ${NAV.map((item) => `<a href="${item.href}" class="${item.href === activeHref ? "active" : ""}">${item.label}</a>`).join("\n    ")}
  </nav>
</header>
<main>
${body}
</main>
</body>
</html>`;
}
