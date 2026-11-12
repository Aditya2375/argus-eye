// Voice + typed chat: keyless, on-device. Browser speech recognition feeds a
// local intent grammar that operates the console — no API key, no cloud LLM.
// Replaces the cloud realtime-agent approach with honest, inspectable intents.
import { bus } from '../core/bus';
import { el, escapeHtml } from '../core/dom';
import { flyTo, resetGlobe, startOrbit, startRotate, stopMotion, viewCenter, cameraState } from '../core/camera';
import { setSensor, cycleSensor, type SensorMode } from '../core/fx';
import { searchPlaces } from '../core/search';
import { tracker } from '../core/track';
import type { HudLayer } from '../core/hud';

export interface VoiceDeps {
  layers: HudLayer[];
  findLayer: (id: string) => HudLayer | undefined;
}

const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition });

export function initVoice(deps: VoiceDeps): void {
  const panel = document.getElementById('voice-panel')!;
  const micBtn = document.getElementById('btn-mic')!;
  const chatBtn = document.getElementById('btn-chat')!;
  let listening = false;
  let recog: SpeechRecognition | null = null;
  let logEl: HTMLElement;
  let input: HTMLInputElement;

  function build(): void {
    panel.classList.add('glass');
    panel.innerHTML = '';
    const head = el('div', 'vp-head');
    head.append(el('span', '', 'ARGUS VOICE'), el('span', 'vp-state', 'KEYLESS · ON-DEVICE'));
    logEl = el('div', 'vp-log');
    const row = el('div', 'vp-input');
    input = document.createElement('input');
    input.placeholder = 'Type a command… ("take me to Tokyo")';
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) { say('user', input.value); void handle(input.value); input.value = ''; } };
    row.append(input);
    panel.append(head, logEl, row);
  }

  function say(who: 'user' | 'agent', text: string): void {
    const msg = el('div', `vp-msg ${who}`);
    msg.innerHTML = `<span class="who">${who === 'user' ? 'YOU' : 'ARGUS'}</span>${escapeHtml(text)}`;
    logEl.append(msg);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function speak(text: string): void {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* no tts */ }
  }

  function reply(text: string): void {
    say('agent', text);
    if (listening) speak(text);
  }

  const SENSOR_WORDS: Record<string, SensorMode> = {
    'normal': 'normal', 'crt': 'crt', 'night vision': 'nvg', 'nvg': 'nvg',
    'flir': 'flir', 'thermal': 'flir', 'noir': 'noir', 'black and white': 'noir',
  };
  const LAYER_WORDS: Record<string, string> = {
    'flights': 'flights', 'planes': 'flights', 'aircraft': 'flights',
    'military': 'military', 'satellites': 'satellites', 'sats': 'satellites',
    'ships': 'vessels', 'vessels': 'vessels', 'earthquakes': 'earthquakes', 'quakes': 'earthquakes',
    'fires': 'fires', 'radio': 'radio', 'traffic': 'traffic', 'cameras': 'cctv', 'cctv': 'cctv',
    'transit': 'transit', 'buses': 'transit', 'rail': 'rail', 'trains': 'rail',
    'wind': 'wind', 'radar': 'wx-radar', 'clouds': 'wx-satellite', 'lightning': 'wx-lightning',
    'cyclones': 'cyclones', 'launches': 'launches', 'space missions': 'launches',
    'datacenters': 'datacenters', 'dams': 'dams', 'cables': 'cables', 'news': 'news',
    'wildlife': 'wildlife', 'bikeshare': 'bikeshare', 'wrecks': 'shipwrecks',
  };

  async function handle(raw: string): Promise<void> {
    const q = raw.toLowerCase().trim();

    // distance: "how far is X from Y"
    const dist = q.match(/how far is (.+?) from (.+)/);
    if (dist) {
      const [a, b] = await Promise.all([searchPlaces(dist[1]), searchPlaces(dist[2])]);
      if (a.length && b.length) {
        const R = 6371;
        const dLat = (b[0].lat - a[0].lat) * Math.PI / 180;
        const dLon = (b[0].lon - a[0].lon) * Math.PI / 180;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0].lat * Math.PI / 180) * Math.cos(b[0].lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        const km = 2 * R * Math.asin(Math.sqrt(h));
        reply(`${a[0].name.split(',')[0]} to ${b[0].name.split(',')[0]} is about ${Math.round(km).toLocaleString('en-US')} kilometers.`);
        bus.emit('whiteboard:connector', { a: a[0], b: b[0], label: `${Math.round(km)} km` });
      } else reply("I couldn't resolve both places.");
      return;
    }

    // fly-to: take me to / show me / fly to / go to
    const fly = q.match(/(?:take me to|fly to|go to|show me|zoom to) (.+)/);
    if (fly) {
      const place = fly[1].replace(/^the /, '');
      // layer names take priority: "show me flights"
      for (const [word, id] of Object.entries(LAYER_WORDS)) {
        if (place === word || place === `${word} layer`) {
          const layer = deps.findLayer(id);
          if (layer && !layer.enabled) { await layer.enable(); bus.emit('layers:refresh'); }
          reply(`${word} layer is on.`);
          return;
        }
      }
      const hits = await searchPlaces(place);
      if (hits.length) {
        flyTo(hits[0].lon, hits[0].lat, hits[0].height ?? 60000);
        reply(`Flying to ${hits[0].name.split(',')[0]}.`);
      } else reply(`I couldn't find "${place}".`);
      return;
    }

    // rotate / orbit / stop / reset
    if (/\brotate\b|\bspin\b/.test(q)) {
      const speed = q.includes('fast') ? 5 : q.includes('slow') ? 0.8 : 1.8;
      startRotate(q.includes('left') || q.includes('west') ? -speed : speed);
      reply('Rotating.');
      return;
    }
    if (/\borbit\b/.test(q)) { startOrbit(q.includes('slow') ? 3 : 7); reply('Orbiting.'); return; }
    if (/\bstop\b/.test(q)) { stopMotion(); reply('Stopped.'); return; }
    if (/\breset\b|\bfull globe\b|\bhome\b/.test(q)) { resetGlobe(); reply('Back to the full globe.'); return; }

    // sensors
    for (const [word, mode] of Object.entries(SENSOR_WORDS)) {
      if (q.includes(word) && /(switch|sensor|mode|vision|go|use|to)/.test(q) && !q.includes('layer')) {
        setSensor(mode);
        reply(`Sensor: ${mode.toUpperCase()}.`);
        return;
      }
    }
    if (q.includes('cycle sensor') || q.includes('next sensor')) { const m = cycleSensor(); reply(`Sensor: ${m.toUpperCase()}.`); return; }

    // layer on/off
    const toggle = q.match(/(turn on|enable|show|activate|turn off|disable|hide|deactivate)( the)? ([a-z ]+)/);
    if (toggle) {
      const on = !/(off|disable|hide|deactivate)/.test(toggle[1]);
      const name = toggle[3].replace(/ layer$/, '').trim();
      for (const [word, id] of Object.entries(LAYER_WORDS)) {
        if (name === word) {
          const layer = deps.findLayer(id);
          if (!layer) { reply(`The ${word} layer isn't available in this build.`); return; }
          if (on && !layer.enabled) { await layer.enable(); reply(`${layer.name} on.`); }
          else if (!on && layer.enabled) { layer.disable(); reply(`${layer.name} off.`); }
          else reply(`${layer.name} is already ${on ? 'on' : 'off'}.`);
          bus.emit('layers:refresh');
          return;
        }
      }
      reply(`I don't know a layer called "${name}".`);
      return;
    }

    // cockpit / track
    if (q.includes('cockpit') || q.includes('enter cockpit')) {
      if (tracker.current) { tracker.enterCockpit(); reply('In the cockpit. Escape to exit.'); }
      else reply('Track something first — click an aircraft or vessel.');
      return;
    }
    if (q.includes('exit cockpit')) { tracker.exitCockpit(); reply('Cockpit exited.'); return; }
    if (q.includes('untrack') || q.includes('stop tracking')) { tracker.untrack(); reply('Untracked.'); return; }

    // analyst: what's on / where am I / count
    if (q.includes("what's on") || q.includes('what is on') || q.includes('what layers')) {
      const on = deps.layers.filter((l) => l.enabled).map((l) => l.name);
      reply(on.length ? `On right now: ${on.join(', ')}.` : 'Nothing is on.');
      return;
    }
    if (q.includes('where am i') || q.includes('what city')) {
      const c = viewCenter();
      const hits = await searchPlaces(`${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`);
      void hits;
      reply(`View center is ${c.lat.toFixed(3)}, ${c.lon.toFixed(3)} at ${(cameraState().height / 1000).toFixed(0)} km up.`);
      return;
    }
    const countQ = q.match(/how many ([a-z ]+)/);
    if (countQ) {
      const name = countQ[1].replace(/ are there| in view| right now/g, '').trim();
      for (const [word, id] of Object.entries(LAYER_WORDS)) {
        if (name.includes(word)) {
          const layer = deps.findLayer(id);
          const n = layer?.count?.();
          reply(n != null ? `${layer!.name}: ${n.toLocaleString('en-US')} live.` : `${layer?.name ?? word} isn't reporting a count${layer?.enabled ? '' : ' — turn it on first'}.`);
          return;
        }
      }
    }

    // play a radio station
    const radioQ = q.match(/play (.+?) (radio|station)/) ?? q.match(/play (.+)/);
    if (radioQ && (q.includes('radio') || q.includes('station') || q.includes(' fm'))) {
      const radio = deps.findLayer('radio');
      if (radio && !radio.enabled) { await radio.enable(); bus.emit('layers:refresh'); }
      const fn = (radio as unknown as { playStationNamed?: (x: string) => boolean } | undefined)?.playStationNamed;
      const target = radioQ[1].replace(/radio|station|fm/g, '').trim();
      if (fn?.(target)) reply(`Tuning ${target}.`);
      else reply(`No station matched "${target}".`);
      return;
    }

    // scene: play a cinematic scene
    if (q.includes('orbital watch') || q.includes('play scene')) {
      bus.emit('scene:play', 'orbital-watch');
      reply('Playing Orbital Watch.');
      return;
    }

    // clear the map
    if (q.includes('clear the map') || q.includes('clear annotations')) {
      const draw = deps.findLayer('draw');
      (draw as unknown as { clearShapes?: () => void })?.clearShapes?.();
      reply('Map cleared.');
      return;
    }

    reply('Try: "take me to Tokyo", "turn on flights", "night vision", "how far is LAX from JFK", "rotate the globe".');
  }

  function startListening(): void {
    const Ctor = SR.SpeechRecognition ?? SR.webkitSpeechRecognition;
    if (!Ctor) {
      say('agent', 'Speech recognition is not available in this browser — use Chrome/Edge, or type below.');
      return;
    }
    recog = new Ctor();
    recog.lang = 'en-US';
    recog.continuous = true;
    recog.interimResults = false;
    recog.onresult = (ev: SpeechRecognitionEvent) => {
      const last = ev.results[ev.results.length - 1];
      const text = last[0]?.transcript;
      if (text) { say('user', text); void handle(text); }
    };
    recog.onend = () => { if (listening) try { recog?.start(); } catch { /* already started */ } };
    recog.onerror = () => { /* keep quiet; onend restarts */ };
    try {
      recog.start();
      listening = true;
      micBtn.classList.add('live');
      say('agent', 'Listening. Say "take me to Tokyo" or "turn on flights".');
    } catch { /* already running */ }
  }

  function stopListening(): void {
    listening = false;
    micBtn.classList.remove('live');
    try { recog?.stop(); } catch { /* noop */ }
  }

  build();
  micBtn.onclick = () => {
    panel.classList.remove('hidden');
    if (listening) stopListening(); else startListening();
  };
  chatBtn.onclick = () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) input.focus();
  };
  bus.emit('voice:ready');
}
