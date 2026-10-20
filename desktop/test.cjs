const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serverUrl, allowedNavigation } = require("./policy.cjs");
test("only secure origins and local development are accepted", () => {
  assert.equal(serverUrl("https://allumi.example/"), "https://allumi.example");
  assert.equal(serverUrl("http://localhost:3000"), "http://localhost:3000");
  for (const value of ["file:///etc/passwd", "javascript:alert(1)", "http://192.168.1.2", "https://user:pass@host.example", "https://host.example/path", "https://host.example?token=secret"]) assert.throws(() => serverUrl(value));
});
test("remote content cannot navigate to local resources or other origins", () => {
  assert.equal(allowedNavigation("https://allumi.example/connexion", "https://allumi.example"), true);
  for (const value of ["file:///etc/passwd", "https://allumi.example.evil.test", "https://evil.test", "javascript:alert(1)"]) assert.equal(allowedNavigation(value, "https://allumi.example"), false);
});
