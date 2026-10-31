import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("message link preview", () => {
  const html = readFileSync(resolve("index.html"), "utf8");
  const document = new DOMParser().parseFromString(html, "text/html");

  it("provides title, description and large image without requiring JavaScript", () => {
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toContain("Candy Map");
    expect(document.querySelector('meta[property="og:description"]')?.getAttribute("content")).toContain("candy");
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
    const image = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    expect(image).toBe("https://d20cdlbs8tmt1h.cloudfront.net/share-card.png");
    expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute("content")).toBe(image);
  });

  it("ships a PNG whose actual dimensions match the preview metadata", () => {
    const png = readFileSync(resolve("public/share-card.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(String(png.readUInt32BE(16))).toBe(document.querySelector('meta[property="og:image:width"]')?.getAttribute("content"));
    expect(String(png.readUInt32BE(20))).toBe(document.querySelector('meta[property="og:image:height"]')?.getAttribute("content"));
  });
});
