import { Wallet, verifyMessage } from "ethers";
import { openedMessage, signedMessage } from "../lib/signed-link.js";

const base = { name: "Ana", host: "Xavier", reason: "Mush Room booking today from 5-7pm", timestamp: "1", startTime: "2", duration: "120" };

describe("signed door links", () => {
  test("Luma links keep their exact signed string and wording", () => {
    const q = { ...base, reason: "Web3 Meetup", eventUrl: "https://lu.ma/x" };
    expect(signedMessage(q)).toBe("name=Ana&host=Xavier&reason=Web3 Meetup&timestamp=1&startTime=2&duration=120&eventUrl=https://lu.ma/x");
    expect(openedMessage(q)).toBe("🚪 Ana opened the door for [Web3 Meetup](<https://lu.ma/x>) hosted by Xavier");
    expect(openedMessage({ ...base, reason: "Web3 Meetup" })).toBe("🚪 Ana opened the door for Web3 Meetup hosted by Xavier");
  });

  test("booking links are signed with booking=1 and say who booked", async () => {
    const q = { ...base, booking: "1" };
    expect(signedMessage(q)).toBe("name=Ana&host=Xavier&reason=Mush Room booking today from 5-7pm&timestamp=1&startTime=2&duration=120&booking=1");
    expect(openedMessage(q)).toBe("🚪 Ana opened the door for Mush Room booking today from 5-7pm (booked by Xavier)");
    const w = Wallet.createRandom();
    const sig = await w.signMessage(signedMessage(q));
    expect(verifyMessage(signedMessage(q), sig)).toBe(w.address);
    // Stripping booking=1 from a booking link breaks the signature
    expect(verifyMessage(signedMessage({ ...q, booking: undefined }), sig)).not.toBe(w.address);
  });
});
