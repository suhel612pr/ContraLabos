/* ============================================================
   CONTRALABOS — SKYLINE CHART (with hover tooltip)
   Renders bars as flat "towers" with a faint window grid,
   matching the construction theme. Hovering a bar shows a
   tooltip explaining what the bar represents.

   Usage:
     renderSkyline("mountId", [
       { label, value, max, display, title, detail }
     ]);
   - label:   short axis label under the bar
   - value:   raw numeric value (drives bar height)
   - max:     the ceiling value bar height is relative to
   - display: text shown above the bar (e.g. "68%" or "₹42,000")
   - title:   optional tooltip heading (defaults to label)
   - detail:  optional extra explanatory line in the tooltip
   ============================================================ */

function ensureChartTooltip(){
  let tip = document.getElementById("chartTooltip");
  if(!tip){
    tip = document.createElement("div");
    tip.id = "chartTooltip";
    tip.style.cssText = `
      position:fixed;z-index:200;pointer-events:none;
      background:var(--c-bg-raised-2);border:1px solid var(--c-border-gold);
      border-radius:4px;padding:10px 12px;font-family:var(--f-sans);
      font-size:11.5px;color:var(--c-text);max-width:240px;
      box-shadow:0 6px 20px rgba(0,0,0,0.5);
      opacity:0;transition:opacity .1s ease;display:none;
    `;
    document.body.appendChild(tip);
  }
  return tip;
}

function renderSkyline(mountId, data){
  const mount = document.getElementById(mountId);
  if(!mount) return;
  mount.classList.add("skyline-chart");
  const tip = ensureChartTooltip();

  mount.innerHTML = data.map((d, i) => {
    const value = Number.isFinite(Number(d.value)) ? Number(d.value) : 0;
    const max = Math.max(Number.isFinite(Number(d.max)) ? Number(d.max) : 0, value, 1);
    const pct = value > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
    const windowCount = Math.max(2, Math.round(pct/12));
    const windows = Array.from({length: windowCount}).map(()=>"<span></span>").join("");
    return `
      <div class="skyline-bar-wrap">
        <div class="skyline-value">${d.display || d.value}</div>
        <div class="skyline-bar" data-idx="${i}" style="height:${pct}%;cursor:pointer;">
          <div class="windows">${windows}</div>
        </div>
        <div class="skyline-label">${d.label}</div>
      </div>`;
  }).join("");

  mount.querySelectorAll(".skyline-bar").forEach((bar) => {
    const d = data[bar.dataset.idx];
    const value = Number.isFinite(Number(d.value)) ? Number(d.value) : 0;
    const max = Math.max(Number.isFinite(Number(d.max)) ? Number(d.max) : 0, value, 1);
    const pctRounded = Math.round((value / max) * 100);

    function showTip(e){
      const title = d.title || d.label;
      const valueLine = `Value: <strong style="color:var(--c-gold-light);">${d.display || d.value}</strong>`;
      const scaleLine = `Relative to: <strong>${max.toLocaleString("en-IN")}</strong>`;
      const pctLine = `Bar height: <strong>${pctRounded}%</strong> of scale`;
      tip.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;color:var(--c-gold-light);">${title}</div>
        <div style="line-height:1.7;">${valueLine}<br>${scaleLine}<br>${pctLine}${d.detail ? `<br><span style="color:var(--c-text-muted);">${d.detail}</span>` : ""}</div>`;
      tip.style.display = "block";
      requestAnimationFrame(() => { tip.style.opacity = "1"; });
      positionTip(e);
      bar.style.filter = "brightness(1.25)";
    }
    function positionTip(e){
      const rect = tip.getBoundingClientRect();
      let x = e.clientX + 14;
      let y = e.clientY - rect.height - 14;
      if(x + rect.width > window.innerWidth - 10) x = e.clientX - rect.width - 14;
      if(y < 10) y = e.clientY + 14;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    }
    function hideTip(){
      tip.style.opacity = "0";
      setTimeout(() => { if(tip.style.opacity === "0") tip.style.display = "none"; }, 100);
      bar.style.filter = "";
    }

    bar.addEventListener("mouseenter", showTip);
    bar.addEventListener("mousemove", positionTip);
    bar.addEventListener("mouseleave", hideTip);
    bar.addEventListener("touchstart", (e) => { showTip(e.touches[0]); }, { passive: true });
  });

  if(!window._skylineTouchHandler){
    window._skylineTouchHandler = (e) => {
      if(!e.target.closest(".skyline-bar")){
        const t = document.getElementById("chartTooltip");
        if(t){ t.style.opacity = "0"; t.style.display = "none"; }
      }
    };
    document.addEventListener("touchstart", window._skylineTouchHandler, { passive: true });
  }
}
