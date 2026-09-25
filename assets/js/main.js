/* ============================================================
   CTOST — Interactions
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Nav: scrolled / light-hero state + hero-title → nav-logo transition ---------- */
  const nav = document.querySelector(".nav");
  const isHome = document.body.dataset.page === "home";
  const heroTitle = document.querySelector(".hero-title");
  const logoText = document.querySelector(".nav .logo-text");
  const navSpacer = document.querySelector(".nav-spacer");
  const SCROLL_RANGE = 360; /* px over which hero title fades into nav */

  const onScroll = () => {
    const y = window.scrollY;
    const scrolled = y > 30;
    nav.classList.toggle("scrolled", scrolled);
    if (isHome) nav.classList.toggle("on-light", !scrolled);

    /* Smooth cross-fade: hero title shrinks/fades up, nav logo fades in + spacer grows */
    if (isHome && heroTitle && logoText) {
      const raw = Math.min(y / SCROLL_RANGE, 1);
      const p = raw * raw * (3 - 2 * raw); /* smoothstep easing */
      heroTitle.style.opacity = String(1 - p);
      heroTitle.style.transform = `translateY(${-p * 50}px) scale(${1 - p * 0.12})`;
      logoText.style.opacity = String(p);
      logoText.style.maxWidth = `${p * 200}px`;
      if (navSpacer) navSpacer.style.flexGrow = String(p);

      /* Liquid glass lens fades out with the hero title */
      const lens = document.querySelector(".liquid-glass-lens");
      if (lens) lens.style.opacity = String(1 - p);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle) {
    toggle.addEventListener("click", () => {
      toggle.classList.toggle("open");
      links.classList.toggle("open");
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        toggle.classList.remove("open");
        links.classList.remove("open");
      })
    );
  }

  /* ---------- Scroll reveal ----------
     Primary: IntersectionObserver.
     Fallback: plain scroll-position check, so content stays accessible
     even in environments where IO/rAF never fires (or JS-free via CSS). */
  const revealEls = [...document.querySelectorAll(".reveal")];

  /* True once the element has entered the viewport — including when it
     has already scrolled past, so skipped content never stays hidden. */
  const inView = (el, pad = 60) => {
    return el.getBoundingClientRect().top < window.innerHeight - pad;
  };

  let io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  const manualReveal = () => {
    revealEls.forEach((el) => {
      if (!el.classList.contains("visible") && inView(el)) {
        el.classList.add("visible");
        if (io) io.unobserve(el);
      }
    });
  };
  window.addEventListener("scroll", manualReveal, { passive: true });
  window.addEventListener("resize", manualReveal);
  manualReveal();

  /* ---------- Animated counters ---------- */
  const counters = [...document.querySelectorAll("[data-count]")];

  const runCounter = (el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = el.dataset.decimals | 0;
    const suffix = el.dataset.suffix || "";
    const duration = 1800;
    const start = performance.now();

    const tick = () => {
      const p = Math.min((performance.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * eased).toFixed(decimals) + suffix;
      if (p < 1) setTimeout(tick, 16);
    };
    tick();
  };

  let cio = null;
  if ("IntersectionObserver" in window) {
    cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            runCounter(e.target);
            cio.unobserve(e.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((el) => cio.observe(el));
  }

  const manualCounters = () => {
    counters.forEach((el) => {
      if (el.dataset.done) return;
      if (inView(el, 0)) {
        el.dataset.done = "1";
        runCounter(el);
        if (cio) cio.unobserve(el);
      }
    });
  };
  window.addEventListener("scroll", manualCounters, { passive: true });
  window.addEventListener("resize", manualCounters);
  manualCounters();

  /* Last-resort polling: covers environments where scroll events
     never fire. Self-terminates once everything is handled. */
  if (revealEls.length || counters.length) {
    const poll = setInterval(() => {
      manualReveal();
      manualCounters();
      const pendingReveals = revealEls.some((el) => !el.classList.contains("visible"));
      const pendingCounters = counters.some((el) => !el.dataset.done);
      if (!pendingReveals && !pendingCounters) clearInterval(poll);
    }, 250);
  }

  /* ---------- Hero dot grid: regular pulsing black dots ---------- */
  const canvas = document.getElementById("hero-canvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    const GAP = 22;
    let W = 0, H = 0, raf, startTime;

    /* Reliable size reading: bounding rect first, then fallbacks */
    function measure() {
      const r = canvas.getBoundingClientRect();
      const w = r.width || canvas.clientWidth || canvas.offsetWidth ||
        (canvas.parentElement ? canvas.parentElement.clientWidth : 0);
      const h = r.height || canvas.clientHeight || canvas.offsetHeight ||
        (canvas.parentElement ? canvas.parentElement.clientHeight : 0);
      return { w: Math.round(w), h: Math.round(h) };
    }

    function resize() {
      const { w, h } = measure();
      if (w > 0 && h > 0) {
        canvas.width = w;
        canvas.height = h;
        W = w;
        H = h;
        return true;
      }
      return false;
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      if (!W || !H) return;
      const elapsed = t - startTime;
      for (let x = GAP / 2; x < W; x += GAP) {
        for (let y = GAP / 2; y < H; y += GAP) {
          const phase = (x * 0.9 + y) * 0.011;
          const s = (Math.sin(elapsed * 0.0016 + phase) + 1) / 2;
          const r = 0.8 + s * 2.6;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(7, 10, 16, ${0.12 + s * 0.45})`;
          ctx.fill();
        }
      }
    }

    function step(t) {
      if (!startTime) startTime = t;
      draw(t);
      raf = requestAnimationFrame(step);
    }

    /* initial: try immediately, then retry until layout is ready */
    const init = () => {
      if (resize()) {
        startTime = null;
        step(performance.now());
      } else {
        setTimeout(init, 80);
      }
    };
    init();

    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(() => {
        resize();
      });
      ro.observe(canvas);
      if (canvas.parentElement) ro.observe(canvas.parentElement);
    }
    window.addEventListener("resize", resize);
  }

  /* ---------- Subtle parallax for panel backgrounds ---------- */
  const bgs = document.querySelectorAll("[data-parallax]");
  if (bgs.length) {
    window.addEventListener(
      "scroll",
      () => {
        bgs.forEach((bg) => {
          const rect = bg.getBoundingClientRect();
          if (rect.bottom > 0 && rect.top < window.innerHeight) {
            const offset = (rect.top - window.innerHeight / 2) * -0.08;
            bg.style.transform = `translateY(${offset}px) scale(1.12)`;
          }
        });
      },
      { passive: true }
    );
  }

  /* ---------- Footer year ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
