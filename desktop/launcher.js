const input = document.querySelector("input");
const button = document.querySelector("button");
window.allumi.savedServer().then((value) => { input.value = value; });
document.querySelector("form").addEventListener("submit", async (event) => {
  event.preventDefault(); button.disabled = true;
  try { const result = await window.allumi.connect(input.value); document.querySelector("#error").textContent = result.error || ""; }
  catch { document.querySelector("#error").textContent = "Connexion impossible / Connection failed"; }
  finally { button.disabled = false; }
});
