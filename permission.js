const grantBtn = document.getElementById("grantBtn");
const statusEl = document.getElementById("status");

grantBtn.addEventListener("click", async () => {
  grantBtn.disabled = true;
  statusEl.textContent = "Requesting…";
  statusEl.className = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // We only needed the prompt to fire; stop the stream immediately so no
    // recording indicator lingers.
    stream.getTracks().forEach((track) => track.stop());
    statusEl.textContent = "Microphone allowed. You can close this tab and use the mic button in the side panel.";
    statusEl.className = "ok";
  } catch (err) {
    statusEl.textContent =
      err.name === "NotAllowedError"
        ? "Microphone was blocked. Click the lock/site-info icon in the address bar, set Microphone to Allow, then try again."
        : `Couldn't access the microphone: ${err.message || err.name}`;
    statusEl.className = "err";
    grantBtn.disabled = false;
  }
});
