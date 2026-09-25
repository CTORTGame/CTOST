/* ============================================================
 * Liquid Glass Text
 * 基于 Shu Ding 的开源实现 https://github.com/shuding/liquid-glass
 * 的核心机制（SVG feDisplacementMap + Canvas 位移图）：
 * 不再在文字下放胶囊，而是让“文字字形本身”成为玻璃——
 * 先渲染文字 alpha，做平滑后求梯度，字形边缘产生折射、
 * 字形内部保持透明，再用文字遮罩，只保留字母形玻璃。
 * MIT License · Copyright (c) 2025 Shu Ding
 * ============================================================ */
(function () {
  "use strict";

  if (window.liquidGlass && window.liquidGlass.destroy) {
    window.liquidGlass.destroy();
  }

  function generateId() {
    return "liquid-glass-" + Math.random().toString(36).substr(2, 9);
  }

  /* 1D 盒式模糊（在 float alpha 上做两遍，得到平滑的字形场） */
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const div = r + r + 1;
    // 横向
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / div;
        const x1 = Math.max(0, x - r);
        const x2 = Math.min(w - 1, x + r + 1);
        acc += src[row + x2] - src[row + x1];
      }
    }
    // 纵向
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / div;
        const y1 = Math.max(0, y - r);
        const y2 = Math.min(h - 1, y + r + 1);
        acc += tmp[y2 * w + x] - tmp[y1 * w + x];
      }
    }
    return out;
  }

  function buildGlass(title, anchor) {
    const tRect = title.getBoundingClientRect();
    const aRect = anchor.getBoundingClientRect();
    if (tRect.width === 0) return null;

    const cs = getComputedStyle(title);
    const fontSize = parseFloat(cs.fontSize);
    const fontWeight = cs.fontWeight || "800";
    const fontFamily = cs.fontFamily;
    const letterSpacing = parseFloat(cs.letterSpacing) || 0;
    const text = title.textContent.trim();

    const w = Math.round(tRect.width);
    const h = Math.round(tRect.height);

    /* ---- 1) 离屏渲染文字，取 alpha（支持多行 \n） ---- */
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d");
    octx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    octx.textBaseline = "alphabetic";
    if ("letterSpacing" in octx) octx.letterSpacing = `${letterSpacing}px`;
    // 逐行绘制（二进制字形含 \n）
    const lines = text.split("\n");
    const lineHeight = fontSize * 1; /* 与 CSS line-height:1 一致 */
    const firstMetrics = octx.measureText(lines[0] || text);
    const ascent = firstMetrics.actualBoundingBoxAscent || fontSize * 0.78;
    octx.fillStyle = "#fff";
    for (let i = 0; i < lines.length; i++) {
      octx.fillText(lines[i], 0, ascent + i * lineHeight);
    }

    const img = octx.getImageData(0, 0, w, h).data;
    const alpha = new Float32Array(w * h);
    for (let i = 0, p = 0; i < img.length; i += 4, p++) alpha[p] = img[i + 3] / 255;

    /* ---- 2) 平滑字形场（模糊半径随字号缩放） ---- */
    const radius = Math.max(3, Math.round(fontSize * 0.07));
    const smooth = boxBlur(alpha, w, h, radius);

    /* ---- 3) 沿梯度方向做位移：字形边缘折射，内部无梯度则透明 ---- */
    const gain = fontSize * 3.2; // 折射强度
    const rawX = new Float32Array(w * h);
    const rawY = new Float32Array(w * h);
    let maxScale = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const xl = smooth[y * w + Math.max(0, x - 1)];
        const xr = smooth[y * w + Math.min(w - 1, x + 1)];
        const yt = smooth[Math.max(0, y - 1) * w + x];
        const yb = smooth[Math.min(h - 1, y + 1) * w + x];
        const gx = (xr - xl) * 0.5;
        const gy = (yb - yt) * 0.5;
        // 只在字形覆盖区附近产生折射
        const cover = alpha[p] > 0.02 ? 1 : smooth[p] > 0.06 ? 1 : 0;
        const dx = gx * gain * cover;
        const dy = gy * gain * cover;
        rawX[p] = dx;
        rawY[p] = dy;
        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
      }
    }

    /* ---- 4) 编码位移图 RG 通道（与 shuding 源码一致的编码方式） ---- */
    maxScale *= 0.5;
    const map = new Uint8ClampedArray(w * h * 4);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      map[i] = (rawX[p] / maxScale + 0.5) * 255;
      map[i + 1] = (rawY[p] / maxScale + 0.5) * 255;
      map[i + 2] = 0;
      map[i + 3] = 255;
    }
    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = w;
    mapCanvas.height = h;
    mapCanvas.getContext("2d").putImageData(new ImageData(map, w, h), 0, 0);

    /* ---- 4b) 字形边缘高光环（外侧亮、内侧暗，随字形走） ---- */
    const rim = new Uint8ClampedArray(w * h * 4);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const s = smooth[p];
      // 外侧白色高光带
      const hi = smoothStep2(0.22, 0.42, s) * (1 - smoothStep2(0.42, 0.5, s));
      // 内侧柔和暗影带
      const lo = smoothStep2(0.5, 0.56, s) * (1 - smoothStep2(0.56, 0.82, s));
      if (hi > 0) {
        rim[i] = rim[i + 1] = rim[i + 2] = 255;
        rim[i + 3] = hi * 150;
      } else if (lo > 0) {
        rim[i] = rim[i + 1] = rim[i + 2] = 10;
        rim[i + 3] = lo * 70;
      }
    }
    function smoothStep2(a, b, t) {
      t = Math.max(0, Math.min(1, (t - a) / (b - a)));
      return t * t * (3 - 2 * t);
    }
    const rimCanvas = document.createElement("canvas");
    rimCanvas.width = w;
    rimCanvas.height = h;
    rimCanvas.getContext("2d").putImageData(new ImageData(rim, w, h), 0, 0);

    /* ---- 4c) 微外扩的遮罩（字形 + 外缘高光环可见区） ---- */
    const maskPx = new Uint8ClampedArray(w * h * 4);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const v = smooth[p] > 0.02 ? 255 : 0;
      maskPx[i] = maskPx[i + 1] = maskPx[i + 2] = v;
      maskPx[i + 3] = 255;
    }
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    maskCanvas.getContext("2d").putImageData(new ImageData(maskPx, w, h), 0, 0);

    const id = generateId();

    /* ---- 5) SVG：位移滤镜 + 文字遮罩 ---- */
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;";
    const defs = document.createElementNS(svgNS, "defs");

    // 位移滤镜
    const filter = document.createElementNS(svgNS, "filter");
    filter.setAttribute("id", `${id}_filter`);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("colorInterpolationFilters", "sRGB");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(w));
    filter.setAttribute("height", String(h));

    const feImage = document.createElementNS(svgNS, "feImage");
    feImage.setAttribute("result", `${id}_mapimg`);
    feImage.setAttribute("width", String(w));
    feImage.setAttribute("height", String(h));
    feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", mapCanvas.toDataURL());

    const feDisp = document.createElementNS(svgNS, "feDisplacementMap");
    feDisp.setAttribute("in", "SourceGraphic");
    feDisp.setAttribute("in2", `${id}_mapimg`);
    feDisp.setAttribute("xChannelSelector", "R");
    feDisp.setAttribute("yChannelSelector", "G");
    feDisp.setAttribute("scale", String(maxScale));

    filter.appendChild(feImage);
    filter.appendChild(feDisp);
    defs.appendChild(filter);

    // 遮罩（平滑场阈值图：字形 + 微扩外缘）
    const mask = document.createElementNS(svgNS, "mask");
    mask.setAttribute("id", `${id}_mask`);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", "0");
    mask.setAttribute("y", "0");
    mask.setAttribute("width", String(w));
    mask.setAttribute("height", String(h));
    const maskImg = document.createElementNS(svgNS, "image");
    maskImg.setAttribute("x", "0");
    maskImg.setAttribute("y", "0");
    maskImg.setAttribute("width", String(w));
    maskImg.setAttribute("height", String(h));
    maskImg.setAttributeNS("http://www.w3.org/1999/xlink", "href", maskCanvas.toDataURL());
    mask.appendChild(maskImg);
    defs.appendChild(mask);

    svg.appendChild(defs);

    /* ---- 6) 玻璃元素：位置与 h1 完全重合，遮罩裁成字形 ---- */
    const glass = document.createElement("div");
    glass.className = "liquid-glass-lens";
    glass.style.cssText = `
      position: absolute;
      left: ${Math.round(tRect.left - aRect.left)}px;
      top: ${Math.round(tRect.top - aRect.top)}px;
      width: ${w}px;
      height: ${h}px;
      z-index: 2;
      pointer-events: none;
      background-color: rgba(10, 15, 24, 0.06);
      background-image: url(${rimCanvas.toDataURL()});
      background-repeat: no-repeat;
      -webkit-mask: url(#${id}_mask);
      mask: url(#${id}_mask);
      backdrop-filter: url(#${id}_filter) blur(0.2px) contrast(1.24) brightness(1.09) saturate(1.18);
      -webkit-backdrop-filter: blur(0.4px) contrast(1.15) brightness(1.05) saturate(1.1);
    `;

    // 若初始化时页面已滚动，保持与标题一致的淡出状态
    const sy = Math.min(window.scrollY / 360, 1);
    const sp = sy * sy * (3 - 2 * sy);
    glass.style.opacity = String(1 - sp);

    // 入场动画结束后解除动画（否则 fill:both 会永久覆盖滚动设置的 inline opacity）
    glass.addEventListener("animationend", () => {
      glass.style.animation = "none";
    }, { once: true });

    anchor.appendChild(svg);
    anchor.appendChild(glass);

    const inst = {
      destroy() {
        svg.remove();
        glass.remove();
        off.remove();
        mapCanvas.remove();
        rimCanvas.remove();
        maskCanvas.remove();
      },
    };
    window.liquidGlass = inst;
    return inst;
  }

  /* 布局就绪后初始化；窗口尺寸变化时重建 */
  let tries = 0;
  const timer = setInterval(() => {
    const title = document.querySelector(".hero-title");
    /* 二进制字形模式下不构建玻璃透镜 */
    if (title && title.classList.contains("is-binary")) {
      clearInterval(timer);
      return;
    }
    const anchor = document.querySelector(".hero-inner");
    if ((title && anchor && buildGlass(title, anchor)) || ++tries > 50) {
      clearInterval(timer);
    }
  }, 100);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const title = document.querySelector(".hero-title");
      if (title && title.classList.contains("is-binary")) return; /* 二进制模式跳过 */
      if (window.liquidGlass) window.liquidGlass.destroy();
      const anchor = document.querySelector(".hero-inner");
      if (title && anchor) buildGlass(title, anchor);
    }, 200);
  });
})();
