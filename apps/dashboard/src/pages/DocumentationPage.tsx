const SNIPPETS = [
  {
    title: "HTML widget",
    code: `<div\n  data-gatekeeper\n  data-site-key="GK_PUBLIC_KEY"\n  data-action="signup">\n</div>\n<script src="https://cdn.gatekeeper.dev/captcha-client.js"></script>`,
  },
  {
    title: "JavaScript",
    code: `GateKeeper.render("#gatekeeper", {\n  siteKey: "GK_PUBLIC_KEY",\n  action: "signup",\n  onSuccess(token) { console.log(token); },\n  onFailure(error) { console.error(error); },\n});`,
  },
  {
    title: "React",
    code: `import { GateKeeperCaptcha } from "@gatekeeper/react";\n\n<GateKeeperCaptcha\n  siteKey="GK_PUBLIC_KEY"\n  action="signup"\n  onSuccess={(token) => submit(token)}\n/>`,
  },
  {
    title: "Vue",
    code: `<GateKeeperCaptcha\n  site-key="GK_PUBLIC_KEY"\n  action="signup"\n  @success="onSuccess"\n/>`,
  },
  {
    title: "Backend verification (Node)",
    code: `import { createGateKeeperClient } from "@gatekeeper/captcha-server";\n\nconst gatekeeper = createGateKeeperClient({ secretKey: process.env.GATEKEEPER_SECRET_KEY! });\n\nconst result = await gatekeeper.verify({ token, action: "signup" });\nif (!result.success) {\n  return res.status(403).json({ error: "verification_failed" });\n}`,
  },
];

export function DocumentationPage() {
  return (
    <div>
      <div className="page-header">
        <h1>Documentation</h1>
      </div>
      <p className="muted">
        Full documentation lives in the repository under <code>docs/</code>: ARCHITECTURE.md, THREAT_MODEL.md, SECURITY.md, PRIVACY.md,
        ACCESSIBILITY.md, OFFLINE_MODE.md, and API.md. Quick-start snippets:
      </p>

      {SNIPPETS.map((s) => (
        <div key={s.title} className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{s.title}</h3>
          <pre style={{ background: "var(--surface-2)", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>
            <code>{s.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
