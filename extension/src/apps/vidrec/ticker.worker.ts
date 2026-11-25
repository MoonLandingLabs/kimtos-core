// A metronome, and nothing else.
//
// The Video Recorder composites camera + screen onto a canvas and records that canvas. The draw
// loop used to be a `requestAnimationFrame` loop — and a browser SUSPENDS rAF in a hidden tab.
// While you share your screen you are, by definition, looking at something else, so the KimtOS tab
// is hidden: the loop stalls, the canvas stops updating, and the recording captured from that
// canvas freezes for exactly as long as you were away (#276).
//
// Window timers are no escape either: Chrome throttles setTimeout/setInterval in a hidden tab to
// roughly once a second, which would turn a 30fps recording into a slideshow.
//
// A WORKER'S TIMERS ARE NOT THROTTLED. So the clock lives here, ticks at the frame rate whatever
// the tab is doing, and the main thread draws on each tick. The recording keeps advancing while
// you are away, which is the entire point of a screen recorder.
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent<{ type: 'start'; interval: number } | { type: 'stop' }>) => {
  const msg = e.data;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (msg.type === 'start') {
    // Never faster than 1ms; a 0 would spin the worker for nothing.
    timer = setInterval(() => self.postMessage(0), Math.max(1, Math.round(msg.interval)));
  }
};
