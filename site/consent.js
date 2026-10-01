"use strict";
(() => {
  // src/consent.ts
  (function() {
    var KEY = "analytics_consent";
    var OWNER_KEY = "ga_opt_out";
    var started = false;
    function read(key) {
      try {
        return localStorage.getItem(key);
      } catch (error) {
        return null;
      }
    }
    function write(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
      }
    }
    function drop(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
      }
    }
    function measurementId() {
      var tag = document.querySelector("script[data-ga-id]");
      return tag ? tag.getAttribute("data-ga-id") || "" : "";
    }
    function ownerOptedOut() {
      return read(OWNER_KEY) === "1";
    }
    function allowed() {
      return !ownerOptedOut() && read(KEY) === "granted";
    }
    function start() {
      if (started || !allowed()) return;
      var id = measurementId();
      if (!id) return;
      started = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() {
        window.dataLayer.push(arguments);
      };
      window.atlasTrack = function atlasTrack(name, params = {}) {
        var _a;
        (_a = window.gtag) == null ? void 0 : _a.call(window, "event", name, params);
      };
      var tag = document.createElement("script");
      tag.async = true;
      tag.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
      document.head.appendChild(tag);
      window.gtag("js", /* @__PURE__ */ new Date());
      window.gtag("config", id, { send_page_view: false });
      window.gtag("event", "page_view", {
        page_location: location.href,
        page_path: location.pathname,
        page_title: document.title
      });
      document.addEventListener(
        "click",
        function(event) {
          var _a;
          var target = event.target;
          var node = target && target.closest ? target.closest("a, button") : null;
          if (!node) return;
          var href = node.getAttribute("href") || "";
          var offsite = /^https?:\/\//.test(href) && href.indexOf(location.host) === -1;
          var scheme = href.indexOf("mailto:") === 0 ? "mailto" : href.indexOf("tel:") === 0 ? "tel" : "";
          (_a = window.gtag) == null ? void 0 : _a.call(window, "event", "element_click", {
            page_path: location.pathname,
            element_id: node.id || "",
            element_kind: node.tagName.toLowerCase(),
            element_role: node.getAttribute("data-ga") || String(node.className || "").split(" ")[0] || "",
            outbound: offsite || scheme === "mailto",
            link_scheme: scheme,
            outbound_host: offsite ? new URL(href).host : ""
          });
        },
        true
      );
      var marks = [25, 50, 75, 100];
      var deepest = 0;
      var sent = {};
      var onScroll = function() {
        var _a;
        var page = document.documentElement.scrollHeight;
        var percent = page <= window.innerHeight ? 100 : Math.min(100, Math.round((window.scrollY + window.innerHeight) / page * 100));
        deepest = Math.max(deepest, percent);
        for (var i = 0; i < marks.length; i += 1) {
          var mark = marks[i];
          if (deepest >= mark && !sent[mark]) {
            sent[mark] = true;
            (_a = window.gtag) == null ? void 0 : _a.call(window, "event", "scroll_depth", { page_path: location.pathname, percent_scrolled: mark });
          }
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
    function applyOwnerSwitch() {
      var params = new URLSearchParams(location.search);
      var flag = params.get("ga");
      if (flag === "off") {
        write(OWNER_KEY, "1");
        if (window.gtag) location.reload();
      }
      if (flag === "on") drop(OWNER_KEY);
    }
    var bar = null;
    function reserveSpace() {
      var root = document.documentElement;
      var height = !bar || bar.hidden ? 0 : Math.ceil(bar.getBoundingClientRect().height);
      if (root.style.getPropertyValue("--consent-height") === height + "px") return;
      root.style.setProperty("--consent-height", height + "px");
    }
    function hide() {
      if (bar) bar.hidden = true;
      reserveSpace();
    }
    function panel() {
      return {
        ask: document.getElementById("consentAsk"),
        prefs: document.getElementById("consentPrefs"),
        settings: document.getElementById("consentSettings"),
        toggle: document.getElementById("consentAnalytics"),
        word: document.getElementById("consentAnalyticsWord")
      };
    }
    function setAnalytics(on) {
      var parts = panel();
      if (parts.toggle) parts.toggle.setAttribute("aria-checked", on ? "true" : "false");
      if (parts.word) parts.word.textContent = on ? "On" : "Off";
    }
    function analyticsOn() {
      var parts = panel();
      return !!parts.toggle && parts.toggle.getAttribute("aria-checked") === "true";
    }
    function openPrefs() {
      if (!bar) return;
      var parts = panel();
      setAnalytics(read(KEY) === "granted");
      if (parts.ask) parts.ask.hidden = true;
      if (parts.prefs) parts.prefs.hidden = false;
      if (parts.settings) parts.settings.hidden = true;
      bar.hidden = false;
      reserveSpace();
      if (parts.prefs) {
        parts.prefs.setAttribute("tabindex", "-1");
        parts.prefs.focus();
      }
    }
    function askMode() {
      var parts = panel();
      if (parts.ask) parts.ask.hidden = false;
      if (parts.prefs) parts.prefs.hidden = true;
      if (parts.settings) parts.settings.hidden = false;
    }
    function show() {
      if (!bar) return;
      askMode();
      bar.hidden = false;
      reserveSpace();
      bar.setAttribute("tabindex", "-1");
      bar.focus();
    }
    function decide(answer) {
      var was = read(KEY);
      write(KEY, answer);
      hide();
      if (answer === "granted") start();
      if (answer === "denied" && was === "granted" && window.gtag) location.reload();
    }
    function setAndDecide(on) {
      setAnalytics(on);
      decide(on ? "granted" : "denied");
    }
    function closePrefs() {
      if (!read(KEY)) {
        show();
        return;
      }
      hide();
    }
    function build() {
      if (!measurementId()) return;
      bar = document.getElementById("consentBar");
      if (!bar) return;
      var accept = document.getElementById("consentAccept");
      var decline = document.getElementById("consentDecline");
      if (accept) accept.addEventListener("click", function() {
        decide("granted");
      });
      if (decline) decline.addEventListener("click", function() {
        decide("denied");
      });
      var parts = panel();
      if (parts.settings) parts.settings.addEventListener("click", openPrefs);
      if (parts.toggle) {
        parts.toggle.addEventListener("click", function() {
          setAndDecide(!analyticsOn());
        });
      }
      var close = document.getElementById("consentClose");
      if (close) close.addEventListener("click", closePrefs);
      document.addEventListener("keydown", function(event) {
        var prefs = document.getElementById("consentPrefs");
        if (event.key === "Escape" && prefs && !prefs.hidden) {
          event.preventDefault();
          closePrefs();
        }
      });
      window.addEventListener("resize", reserveSpace);
      window.addEventListener("orientationchange", reserveSpace);
      window.addEventListener("load", reserveSpace);
      if (typeof ResizeObserver === "function") new ResizeObserver(reserveSpace).observe(bar);
      document.addEventListener(
        "click",
        (event) => {
          var _a;
          const target = event.target;
          if ((_a = target == null ? void 0 : target.closest) == null ? void 0 : _a.call(target, "#consentBtn")) openPrefs();
        },
        true
      );
      if (!read(KEY)) {
        show();
      }
    }
    applyOwnerSwitch();
    start();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", build);
    } else {
      build();
    }
  })();
})();
