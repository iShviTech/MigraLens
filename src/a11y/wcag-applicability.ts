/**
 * What kind of content is on the page, used to mark criteria not applicable.
 */

import type { Page } from "playwright";
import type { Applicability } from "./wcag-catalog.js";

export interface PageApplicability {
  video: boolean;
  audio: boolean;
  liveMedia: boolean;
  form: boolean;
  password: boolean;
  navigation: boolean;
  heading: boolean;
  animation: boolean;
  draggable: boolean;
  dialog: boolean;
  text: boolean;
  image: boolean;
}

const APPLICABILITY_SCRIPT = `(() => {
  var bodyText = document.body ? document.body.innerText : "";
  var compact = bodyText.replace(/\\s+/g, " ").trim();
  var liveText = /\\blive\\s+(stream|video|audio|broadcast|caption)/i.test(compact);
  var animated = false;
  var nodes = document.querySelectorAll("body *");
  for (var i = 0; i < nodes.length && i < 400; i += 1) {
    var name = getComputedStyle(nodes[i]).animationName;
    if (name && name !== "none") {
      animated = true;
      break;
    }
  }
  var form = false;
  var controls = document.querySelectorAll("input, select, textarea");
  for (var c = 0; c < controls.length; c += 1) {
    var control = controls[c];
    if (control.getAttribute("type") === "hidden") continue;
    form = true;
    break;
  }
  return {
    video: document.querySelectorAll("video").length > 0,
    audio: document.querySelectorAll("audio").length > 0,
    liveMedia: liveText,
    form: form,
    password: document.querySelectorAll("input[type=password]").length > 0,
    navigation: document.querySelectorAll("nav a[href]").length > 0,
    heading: document.querySelectorAll("h1, h2, h3, [role=heading]").length > 0,
    animation: animated || document.querySelectorAll("video").length > 0,
    draggable: document.querySelectorAll("[draggable=true]").length > 0,
    dialog: document.querySelectorAll("dialog, [role=dialog]").length > 0,
    text: compact.length > 40,
    image: document.querySelectorAll("img, svg").length > 0
  };
})()`;

export async function readApplicability(page: Page): Promise<PageApplicability> {
  return page.evaluate(APPLICABILITY_SCRIPT) as Promise<PageApplicability>;
}

export function contentApplies(kind: Applicability, probe: PageApplicability | undefined): boolean {
  if (!probe || kind === "always") {
    return true;
  }
  if (kind === "media") {
    return probe.video || probe.audio;
  }
  if (kind === "video") {
    return probe.video;
  }
  if (kind === "audio") {
    return probe.audio;
  }
  if (kind === "live") {
    return probe.liveMedia || probe.video || probe.audio;
  }
  if (kind === "form") {
    return probe.form;
  }
  if (kind === "auth") {
    return probe.password;
  }
  if (kind === "text") {
    return probe.text;
  }
  if (kind === "image") {
    return probe.image;
  }
  return probe.draggable;
}
