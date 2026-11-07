// DS-11 item 7: apply a stored manual theme before the first paint (loaded by index.html in <head>).
// A file of its own, not an inline script: the CSP allows scripts from the app's origin only (NFR-14 FR 3).
(function () {
  try {
    var t = localStorage.getItem("ws-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch {
    // Storage unavailable (private mode, blocked): keep the system theme.
  }
})();
