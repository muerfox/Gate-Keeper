// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateKeeperWidget } from "./widget.js";
import type { PublicChallenge } from "@gatekeeper/shared";

const accessibleChallenge: PublicChallenge = {
  id: "chal_1",
  type: "accessible_alternative",
  difficulty: 1,
  siteId: "site_1",
  action: "signup",
  issuedAt: Date.now(),
  expiresAt: Date.now() + 90_000,
  payload: {
    instruction: "Pick the color",
    options: [
      { id: "w0", word: "keyboard" },
      { id: "w1", word: "amber" },
      { id: "w2", word: "lantern" },
    ],
  },
  signedEnvelope: "signed.envelope.value",
};

describe("GateKeeperWidget", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a challenge, submits the user's answer, and reports success with a token", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(accessibleChallenge), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, outcome: "SUCCESS", riskLevel: "LOW", token: "signed.token.value" }), { status: 200 }),
      );

    const container = document.createElement("div");
    document.body.append(container);

    const onSuccess = vi.fn();
    const widget = new GateKeeperWidget(container, { siteKey: "gk_pub_test", action: "signup", onSuccess });
    // run() does not resolve until the challenge is answered, so it must
    // not be awaited before we can interact with the rendered <select>.
    void widget.run();

    const select = await vi.waitFor(() => {
      const el = container.shadowRoot!.querySelector("select");
      if (!el) throw new Error("select not yet rendered");
      return el;
    });
    select.value = "w1";
    select.dispatchEvent(new Event("change"));
    container.shadowRoot!.querySelector("button")!.click();

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith("signed.token.value"));

    const verifyCall = fetchMock.mock.calls[1]!;
    const verifyBody = JSON.parse(verifyCall[1].body);
    expect(verifyBody.answer).toBe("w1");
    expect(verifyBody.challengeId).toBe("chal_1");
  });

  it("reports failure without a token when verification fails", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(accessibleChallenge), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, outcome: "FAILED_ANSWER", riskLevel: "MEDIUM" }), { status: 200 }));

    const container = document.createElement("div");
    document.body.append(container);
    const onFailure = vi.fn();
    const widget = new GateKeeperWidget(container, { siteKey: "gk_pub_test", action: "signup", onFailure });
    void widget.run();

    const select = await vi.waitFor(() => {
      const el = container.shadowRoot!.querySelector("select");
      if (!el) throw new Error("select not yet rendered");
      return el;
    });
    select.value = "w0";
    select.dispatchEvent(new Event("change"));
    container.shadowRoot!.querySelector("button")!.click();

    await vi.waitFor(() => expect(onFailure).toHaveBeenCalled());
    expect(onFailure.mock.calls[0]![0].code).toBe("FAILED_ANSWER");
  });

  it("surfaces a network/API error via onFailure rather than throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const container = document.createElement("div");
    document.body.append(container);
    const onFailure = vi.fn();
    const widget = new GateKeeperWidget(container, { siteKey: "gk_pub_bad", action: "signup", onFailure });
    await widget.run();

    expect(onFailure).toHaveBeenCalled();
    expect(onFailure.mock.calls[0]![0].code).toBe("invalid_site_key");
  });
});
